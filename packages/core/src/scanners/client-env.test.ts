// client-env scanner tests. Backend secrets exposed to the browser via a
// public env-var prefix. VULN/CONTROL per severity tier + precision cases.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SourceFile } from "./secrets.js";
import { analyzeClientEnv } from "./client-env.js";

function file(path: string, content: string): SourceFile {
  return { path, content };
}

// ── critical: service_role reaching the browser ────────────────────────

test("VULN: NEXT_PUBLIC service_role key is critical", () => {
  const f = file(
    "src/lib/supabase.ts",
    `import { createClient } from "@supabase/supabase-js";
     export const admin = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY!);`,
  );
  const out = analyzeClientEnv([f]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.ruleId, "client_exposed_secret");
  assert.equal(out[0]!.severity, "critical");
  assert.equal(out[0]!.confidence, "high");
  assert.equal(out[0]!.varName, "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY");
});

test("VULN: VITE_ service key (Lovable-shape) is critical", () => {
  const f = file(
    "src/integrations/supabase/client.ts",
    `const key = import.meta.env.VITE_SUPABASE_SERVICE_KEY;`,
  );
  const out = analyzeClientEnv([f]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.severity, "critical");
});

test("VULN: NEXT_PUBLIC db password defined in .env is critical", () => {
  const f = file(".env", `NEXT_PUBLIC_DB_PASSWORD=hunter2\nNEXT_PUBLIC_API_URL=https://x`);
  const out = analyzeClientEnv([f]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.varName, "NEXT_PUBLIC_DB_PASSWORD");
  assert.equal(out[0]!.severity, "critical");
});

// ── high: ambiguous secret-ish names ───────────────────────────────────

test("VULN: NEXT_PUBLIC_STRIPE_SECRET_KEY is critical (SECRET_KEY)", () => {
  const f = file("src/pay.ts", `const k = process.env.NEXT_PUBLIC_STRIPE_SECRET_KEY;`);
  const out = analyzeClientEnv([f]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.severity, "critical");
});

test("VULN: a trailing _SECRET under a public prefix is high", () => {
  const f = file("src/x.ts", `const k = process.env.NEXT_PUBLIC_WEBHOOK_SECRET;`);
  const out = analyzeClientEnv([f]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.severity, "high");
  assert.equal(out[0]!.confidence, "medium");
});

// ── controls: public-by-design keys never fire ─────────────────────────

test("CONTROL: NEXT_PUBLIC_SUPABASE_ANON_KEY is not flagged", () => {
  const f = file("src/lib/supabase.ts", `createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);`);
  assert.equal(analyzeClientEnv([f]).length, 0);
});

test("CONTROL: publishable + bare API keys are not flagged", () => {
  const f = file(
    "src/x.ts",
    `const a = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
     const b = import.meta.env.VITE_FIREBASE_API_KEY;
     const c = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
     const d = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;`,
  );
  assert.equal(analyzeClientEnv([f]).length, 0);
});

test("CONTROL: a server-only var (no public prefix) is not flagged", () => {
  const f = file("src/server.ts", `const k = process.env.SUPABASE_SERVICE_ROLE_KEY;`);
  assert.equal(
    analyzeClientEnv([f]).length,
    0,
    "no public prefix means it stays server-side; secrets.ts handles the literal value",
  );
});

test("CONTROL: SECRET not at the end (feature-flag-shaped) is not flagged", () => {
  const f = file("src/x.ts", `const on = process.env.NEXT_PUBLIC_SECRET_SANTA_ENABLED;`);
  assert.equal(analyzeClientEnv([f]).length, 0);
});

// ── dedup + ordering ───────────────────────────────────────────────────

test("a var referenced many times in one file is reported once", () => {
  const f = file(
    "src/x.ts",
    `const a = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;
     function f() { return process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY; }`,
  );
  assert.equal(analyzeClientEnv([f]).length, 1);
});

test("findings are severity-ordered and fingerprints stable + unique", () => {
  const files = [
    file("a.ts", `process.env.NEXT_PUBLIC_WEBHOOK_SECRET`),
    file("b.ts", `process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`),
  ];
  const a = analyzeClientEnv(files);
  const b = analyzeClientEnv(files);
  assert.equal(a.length, 2);
  assert.equal(a[0]!.severity, "critical");
  assert.equal(a[1]!.severity, "high");
  assert.deepEqual(a.map((x) => x.fingerprint), b.map((x) => x.fingerprint));
  assert.notEqual(a[0]!.fingerprint, a[1]!.fingerprint);
});
