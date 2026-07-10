import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeBackend,
  curateFilesForAnalyzer,
  extractRawSignals,
  fallbackReport,
  validateReport,
  type BackendReport,
  type RawSignals,
} from "./analyze-backend.js";
import type { LlmAgentDriver, LlmStep } from "./loop.js";
import type { SourceFile } from "../scanners/secrets.js";

function file(path: string, content: string): SourceFile {
  return { path, content };
}

function scripted(steps: LlmStep[]): LlmAgentDriver {
  let i = 0;
  return {
    start: async () => steps[i++]!,
    provideToolResults: async () => steps[i++]!,
  };
}

// ─── Layer 1 — deterministic extraction ─────────────────────────────────────

test("extractRawSignals picks up Supabase URL + publishable key from .env style", () => {
  const files = [
    file(
      ".env",
      'VITE_SUPABASE_URL=https://abcdefghijklmnop.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_abcdef123456ghij7890klmnop',
    ),
    file(
      "src/integrations/supabase/client.ts",
      'import { createClient } from "@supabase/supabase-js";\nconst SUPABASE_URL = "https://abcdefghijklmnop.supabase.co";\nconst SUPABASE_KEY = "sb_publishable_abcdef123456ghij7890klmnop";',
    ),
    file(
      "package.json",
      JSON.stringify({ dependencies: { "@supabase/supabase-js": "^2.0.0", react: "^18" } }),
    ),
  ];
  const s = extractRawSignals(files);
  assert.equal(s.urls.length, 1);
  assert.equal(s.urls[0]!.kind, "supabase");
  assert.equal(s.urls[0]!.value, "https://abcdefghijklmnop.supabase.co");
  assert.ok(s.keys.some((k) => k.kind === "supabase_publishable"));
  assert.ok(s.dependencies.includes("@supabase/supabase-js"));
  assert.ok(s.envKeyNames.includes("VITE_SUPABASE_URL"));
});

test("extractRawSignals catches Supabase anon JWT", () => {
  // Handcrafted JWT with role=anon in payload (base64 of {"role":"anon"})
  const jwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
    Buffer.from('{"role":"anon"}').toString("base64").replace(/=/g, "") +
    ".signature";
  const files = [file(".env", `SUPABASE_ANON_KEY=${jwt}`)];
  const s = extractRawSignals(files);
  assert.ok(s.keys.some((k) => k.kind === "supabase_anon_jwt"));
});

test("extractRawSignals does NOT flag a service_role JWT as anon", () => {
  const jwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
    Buffer.from('{"role":"service_role"}').toString("base64").replace(/=/g, "") +
    ".sig";
  const files = [file("secret.ts", `const SR = "${jwt}";`)];
  const s = extractRawSignals(files);
  assert.equal(
    s.keys.filter((k) => k.kind === "supabase_anon_jwt").length,
    0,
  );
});

test("extractRawSignals recognises Firebase configuration + API key", () => {
  const files = [
    file(
      "src/firebase.ts",
      "import { initializeApp } from 'firebase/app';\nconst firebaseConfig = {\n  apiKey: 'AIzaSyD1234567890abcdefghijklmnopqrstuvw',\n  authDomain: 'my-app.firebaseapp.com',\n};\nexport const app = initializeApp(firebaseConfig);",
    ),
    file(
      "firebase.json",
      JSON.stringify({ hosting: {} }),
    ),
    file(
      "package.json",
      JSON.stringify({ dependencies: { firebase: "^10" } }),
    ),
  ];
  const s = extractRawSignals(files);
  assert.ok(s.keys.some((k) => k.kind === "firebase_api_key"));
  assert.ok(s.configFiles.includes("firebase.json"));
  assert.ok(s.dependencies.includes("firebase"));
});

test("extractRawSignals does not treat a Google Maps API key outside Firebase context as firebase_api_key", () => {
  const files = [
    file("src/maps.ts", "const GMAPS = 'AIzaSyGoogleMaps00000000000000000000000';\n"),
  ];
  const s = extractRawSignals(files);
  assert.equal(s.keys.length, 0);
});

test("extractRawSignals recognises Convex deployment URL + dep", () => {
  const files = [
    file(
      "src/convex.ts",
      "import { ConvexReactClient } from 'convex/react';\nconst convex = new ConvexReactClient('https://happy-owl-123.convex.cloud');",
    ),
    file("convex/schema.ts", "import { defineSchema } from 'convex/server';"),
    file("package.json", JSON.stringify({ dependencies: { convex: "^1" } })),
  ];
  const s = extractRawSignals(files);
  assert.ok(s.urls.some((u) => u.kind === "convex"));
  assert.ok(s.dependencies.includes("convex"));
});

test("extractRawSignals surfaces signup path hints", () => {
  const files = [
    file("app/auth/signup/page.tsx", "export default function SignUp() { return null }"),
    file("src/pages/register.tsx", "export default function Register() { return null }"),
  ];
  const s = extractRawSignals(files);
  assert.ok(s.signupHints.length >= 1);
});

// ─── Layer 3 — anti-fabrication gate ────────────────────────────────────────

function briefFrom(publicConfig: BackendReport["publicConfig"]): BackendReport {
  return {
    version: 1,
    primary: { type: "supabase", confidence: "medium", reason: "test" },
    publicConfig,
    authFlow: { providers: [], signupPath: null, narrative: "" },
    hints: [],
    warnings: [],
    analyzedAt: "2026-07-09T00:00:00Z",
  };
}

test("validateReport strips a fabricated Supabase URL not in RawSignals", () => {
  const signals: RawSignals = {
    urls: [{ value: "https://real000000000000000.supabase.co", path: ".env", kind: "supabase" }],
    keys: [],
    configFiles: [],
    dependencies: [],
    envKeyNames: [],
    signupHints: [],
  };
  const brief = briefFrom({ supabaseUrl: "https://hallucinated0000000.supabase.co" });
  const cleaned = validateReport(brief, signals);
  assert.equal(cleaned.publicConfig.supabaseUrl, undefined);
  assert.ok(cleaned.warnings.some((w) => /supabaseUrl/.test(w)));
});

test("validateReport passes through a URL that DOES appear in RawSignals", () => {
  const url = "https://real000000000000000.supabase.co";
  const signals: RawSignals = {
    urls: [{ value: url, path: ".env", kind: "supabase" }],
    keys: [],
    configFiles: [],
    dependencies: [],
    envKeyNames: [],
    signupHints: [],
  };
  const brief = briefFrom({ supabaseUrl: url });
  const cleaned = validateReport(brief, signals);
  assert.equal(cleaned.publicConfig.supabaseUrl, url);
  assert.equal(cleaned.warnings.length, 0);
});

test("validateReport strips a fabricated anon key", () => {
  const signals: RawSignals = {
    urls: [],
    keys: [{ value: "sb_publishable_real000000000000000000", path: ".env", kind: "supabase_publishable" }],
    configFiles: [],
    dependencies: [],
    envKeyNames: [],
    signupHints: [],
  };
  const brief = briefFrom({ supabaseAnonKey: "sb_publishable_hallucinated00000000000" });
  const cleaned = validateReport(brief, signals);
  assert.equal(cleaned.publicConfig.supabaseAnonKey, undefined);
});

// ─── Fallback (LLM-less) ────────────────────────────────────────────────────

test("fallbackReport marks a Supabase project as low-confidence Supabase", () => {
  const s = extractRawSignals([
    file(".env", "VITE_SUPABASE_URL=https://abcdefghijklmnop.supabase.co"),
    file("package.json", JSON.stringify({ dependencies: { "@supabase/supabase-js": "^2" } })),
  ]);
  const b = fallbackReport(s);
  assert.equal(b.primary.type, "supabase");
  assert.equal(b.primary.confidence, "low");
  assert.equal(b.publicConfig.supabaseUrl, "https://abcdefghijklmnop.supabase.co");
  assert.equal(b.publicConfig.supabaseRef, "abcdefghijklmnop");
});

test("fallbackReport returns 'unknown' when nothing matches", () => {
  const s = extractRawSignals([file("app.ts", "const x = 1;")]);
  const b = fallbackReport(s);
  assert.equal(b.primary.type, "unknown");
});

// ─── Curator ───────────────────────────────────────────────────────────────

test("curateFilesForAnalyzer prefers config files + signup + integration paths", () => {
  const files = [
    file("supabase/config.toml", "[api]"),
    file("app/auth/signup/page.tsx", "export default function () {}"),
    file("src/integrations/supabase/client.ts", "createClient(...)"),
    file("app/layout.tsx", "export default function Layout() {}"),
    file("src/some-unrelated.tsx", "unrelated"),
    file("README.md", "readme"),
  ];
  const s = extractRawSignals([file(".env", "VITE_SUPABASE_URL=https://x1234567890abcdef.supabase.co")]);
  const curated = curateFilesForAnalyzer(files, {
    ...s,
    signupHints: ["app/auth/signup/page.tsx"],
  });
  assert.ok(curated.some((f) => f.path === "supabase/config.toml"));
  assert.ok(curated.some((f) => f.path === "app/auth/signup/page.tsx"));
  assert.ok(curated.some((f) => f.path === "src/integrations/supabase/client.ts"));
  assert.ok(!curated.some((f) => f.path === "README.md"));
});

// ─── analyzeBackend orchestration ──────────────────────────────────────────

test("analyzeBackend without driver returns deterministic fallback", async () => {
  const files = [
    file(".env", "VITE_SUPABASE_URL=https://xxxxxxxxxxxxxxxx.supabase.co"),
    file("package.json", JSON.stringify({ dependencies: { "@supabase/supabase-js": "^2" } })),
  ];
  const brief = await analyzeBackend(files);
  assert.equal(brief.primary.type, "supabase");
  assert.equal(brief.primary.confidence, "low");
});

test("analyzeBackend with driver composes brief + strips fabricated URLs", async () => {
  const files = [
    file(".env", "VITE_SUPABASE_URL=https://real000000000000000.supabase.co"),
    file("package.json", JSON.stringify({ dependencies: { "@supabase/supabase-js": "^2" } })),
  ];
  // Scripted driver: LLM returns high confidence + a FAKE URL not in the repo
  const driver = scripted([
    {
      assistantText: "",
      toolCalls: [
        {
          id: "a1",
          name: "report_brief",
          input: {
            primary: { type: "supabase", confidence: "high", reason: "Supabase client + URL in .env" },
            publicConfig: {
              supabaseUrl: "https://hallucinated0000000.supabase.co",
              supabaseAnonKey: "sb_publishable_faked00000000000000000",
            },
            authFlow: { providers: ["email"], signupPath: null, narrative: "Email + password" },
            hints: [".env has your URL"],
            warnings: [],
          },
        },
      ],
      done: true,
    },
  ]);
  const brief = await analyzeBackend(files, { driver });
  assert.equal(brief.primary.confidence, "high");
  // Fabricated URL is stripped by the gate
  assert.equal(brief.publicConfig.supabaseUrl, undefined);
  assert.equal(brief.publicConfig.supabaseAnonKey, undefined);
  assert.ok(brief.warnings.length > 0);
});

test("analyzeBackend on a driver crash returns fallback", async () => {
  const driver: LlmAgentDriver = {
    start: async () => {
      throw new Error("boom");
    },
    provideToolResults: async () => ({ assistantText: "", toolCalls: [], done: true }),
  };
  const files = [
    file(".env", "VITE_SUPABASE_URL=https://xxxxxxxxxxxxxxxx.supabase.co"),
    file("package.json", JSON.stringify({ dependencies: { "@supabase/supabase-js": "^2" } })),
  ];
  const brief = await analyzeBackend(files, { driver });
  assert.equal(brief.primary.type, "supabase");
  assert.equal(brief.primary.confidence, "low");
});
