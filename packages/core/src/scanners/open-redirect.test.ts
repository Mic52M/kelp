// open-redirect scanner tests. VULN/CONTROL per shape + guard suppression.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SourceFile } from "./secrets.js";
import { analyzeOpenRedirect } from "./open-redirect.js";

function file(path: string, content: string): SourceFile {
  return { path, content };
}

test("VULN: redirect() fed directly from searchParams is flagged (high conf)", () => {
  const f = file(
    "app/page.tsx",
    `import { redirect } from "next/navigation";
     export default function P({ searchParams }) {
       redirect(searchParams.get("next"));
     }`,
  );
  const out = analyzeOpenRedirect([f]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.ruleId, "open_redirect");
  assert.equal(out[0]!.confidence, "high");
});

test("VULN: NextResponse.redirect via a tainted variable is flagged (medium)", () => {
  const f = file(
    "app/api/go/route.ts",
    `export function GET(req) {
       const dest = req.nextUrl.searchParams.get("to");
       return NextResponse.redirect(dest);
     }`,
  );
  const out = analyzeOpenRedirect([f]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.confidence, "medium");
});

test("VULN: auth callback open redirect is high severity", () => {
  const f = file(
    "app/auth/callback/route.ts",
    `export function GET(req) {
       const next = req.nextUrl.searchParams.get("next");
       return NextResponse.redirect(next);
     }`,
  );
  const out = analyzeOpenRedirect([f]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.severity, "high");
});

test("VULN: pages/api res.redirect from req.query", () => {
  const f = file(
    "pages/api/redirect.ts",
    `export default function handler(req, res) { res.redirect(req.query.url); }`,
  );
  assert.equal(analyzeOpenRedirect([f]).length, 1);
});

test("VULN: client-side location.href assignment from params", () => {
  const f = file(
    "src/components/Redirector.tsx",
    `const params = new URLSearchParams(location.search);
     window.location.href = params.get("redirect");`,
  );
  assert.equal(analyzeOpenRedirect([f]).length, 1);
});

test("CONTROL: a static/literal redirect target is not flagged", () => {
  const f = file(
    "app/page.tsx",
    `import { redirect } from "next/navigation";
     redirect("/dashboard");`,
  );
  assert.equal(analyzeOpenRedirect([f]).length, 0);
});

test("CONTROL: a relative-path guard suppresses the file", () => {
  const f = file(
    "app/auth/callback/route.ts",
    `const next = req.nextUrl.searchParams.get("next") ?? "/";
     const safe = next.startsWith("/") ? next : "/";
     return NextResponse.redirect(safe);`,
  );
  assert.equal(analyzeOpenRedirect([f]).length, 0);
});

test("CONTROL: an allowlist validator suppresses the file", () => {
  const f = file(
    "app/api/go/route.ts",
    `const dest = req.nextUrl.searchParams.get("to");
     if (!isValidRedirect(dest)) return NextResponse.redirect("/");
     return NextResponse.redirect(dest);`,
  );
  assert.equal(analyzeOpenRedirect([f]).length, 0);
});

test("fingerprints stable; findings severity-ordered", () => {
  const files = [
    file("app/page.tsx", `redirect(searchParams.get("next"));`),
    file("app/auth/callback/route.ts", `NextResponse.redirect(req.nextUrl.searchParams.get("next"));`),
  ];
  const a = analyzeOpenRedirect(files);
  const b = analyzeOpenRedirect(files);
  assert.equal(a.length, 2);
  assert.equal(a[0]!.severity, "high"); // auth callback first
  assert.deepEqual(a.map((x) => x.fingerprint), b.map((x) => x.fingerprint));
});
