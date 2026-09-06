import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSecrets, shannonEntropy, shouldScanPath } from "./secrets.js";

function jwt(role: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
    "base64url",
  );
  const payload = Buffer.from(JSON.stringify({ role, iss: "supabase" })).toString(
    "base64url",
  );
  return `${header}.${payload}.c2lnbmF0dXJlc2lnbmF0dXJl`;
}

test("finds a Stripe live secret key and marks it critical", () => {
  const findings = detectSecrets([
    { path: "server/pay.ts", content: 'const k = "sk_live_51H8xQh2eZvKYlo2CabcdEFGH"' },
  ]);
  const f = findings.find((x) => x.ruleId === "stripe-secret-live");
  assert.ok(f, "should detect stripe live key");
  assert.equal(f!.severity, "critical");
  assert.ok(!f!.preview.includes("51H8xQh2"), "value must be masked");
});

test("bumps severity when secret is in a client-side file", () => {
  const server = detectSecrets([
    { path: "server/x.ts", content: 'k="sk_test_abcdEFGH1234ijklMNOP"' },
  ])[0];
  const client = detectSecrets([
    { path: "src/components/Pay.tsx", content: 'k="sk_test_abcdEFGH1234ijklMNOP"' },
  ])[0];
  assert.equal(server!.severity, "high");
  assert.equal(client!.severity, "critical", "client-side bumps high -> critical");
  assert.equal(client!.clientSide, true);
});

test("flags Supabase service_role JWT as critical", () => {
  const findings = detectSecrets([
    { path: "src/lib/supabase.ts", content: `const key = "${jwt("service_role")}"` },
  ]);
  const f = findings.find((x) => x.ruleId === "supabase-service-role");
  assert.ok(f, "service_role must be flagged");
  assert.equal(f!.severity, "critical");
});

test("ignores Supabase anon JWT (public by design)", () => {
  const findings = detectSecrets([
    { path: "src/lib/supabase.ts", content: `const key = "${jwt("anon")}"` },
  ]);
  assert.equal(
    findings.filter((x) => x.provider === "Supabase" || x.ruleId === "jwt-exposed")
      .length,
    0,
    "anon key must not be flagged",
  );
});

test("skips node_modules and lock files", () => {
  assert.equal(shouldScanPath("node_modules/foo/index.js"), false);
  assert.equal(shouldScanPath("package-lock.json"), false);
  assert.equal(shouldScanPath(".env.example"), false);
  assert.equal(shouldScanPath("src/app.ts"), true);
});

test("ignores placeholder values", () => {
  const findings = detectSecrets([
    { path: "src/config.ts", content: 'const apiKey = "your_api_key_here"' },
  ]);
  assert.equal(findings.length, 0);
});

test("ignores template-literal idempotency keys (dynamic, not secrets)", () => {
  // Real false positives reported from usatopoint-test: an idempotencyKey built
  // from a record id + timestamp. `${…}` means it's constructed at runtime.
  const findings = detectSecrets([
    {
      path: "src/pages/admin/AdminRequests.tsx",
      content: "const idempotencyKey = `req-update-${r.id}-${Date.now()}`;",
    },
    {
      path: "src/pages/admin/AdminProposals.tsx",
      content: "const idempotencyKey = `proposal-reply-${id}-${Date.now()}`;",
    },
  ]);
  assert.equal(findings.length, 0, "interpolated template literals must not be flagged as secrets");
});

test("Supabase anon publishable key produces NO finding (public by design)", () => {
  // The real-world Lovable/Bolt pattern: anon key assigned in a client file.
  const findings = detectSecrets([
    {
      path: "src/integrations/supabase/client.ts",
      content: `const SUPABASE_PUBLISHABLE_KEY = "${jwt("anon")}"`,
    },
  ]);
  assert.equal(findings.length, 0, "anon key must not be flagged, not even via entropy");
});

test("service_role key is flagged once (critical), not duplicated by entropy", () => {
  const findings = detectSecrets([
    {
      path: "src/integrations/supabase/client.ts",
      content: `const SUPABASE_KEY = "${jwt("service_role")}"`,
    },
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.severity, "critical");
  assert.equal(findings[0]!.ruleId, "supabase-service-role");
});

test("detects a private key block", () => {
  const findings = detectSecrets([
    {
      path: "keys/id_rsa",
      content: "-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----",
    },
  ]);
  assert.ok(findings.some((f) => f.ruleId === "private-key-block"));
});

test("high-entropy string beats a low-entropy one", () => {
  assert.ok(shannonEntropy("aaaaaaaaaaaaaaaa") < 1);
  assert.ok(shannonEntropy("Xk92Lm4Qz7Rt1Yw8Nb3Vc6Pd0") > 4);
});

test("snake_case text assigned to a *_KEY name is NOT flagged (entropy false positive)", () => {
  // Regression for #18: a localStorage key like this cleared the entropy bar but
  // is human-readable text, not a secret — auto-fixing it would break the app.
  const findings = detectSecrets([
    { path: "src/hooks/useWorkoutSync.ts", content: "const STORAGE_KEY = 'blackfit_pending_workouts';" },
  ]);
  assert.equal(findings.length, 0);
});

test("all-lowercase word phrase is not flagged, but a mixed-charset token is", () => {
  const text = detectSecrets([{ path: "a.ts", content: "const apiKey = 'user_preferences_cache_value';" }]);
  assert.equal(text.length, 0, "single character class → treated as readable text");

  const token = detectSecrets([{ path: "b.ts", content: "const apiKey = 'Xk92Lm4Qz7Rt1Yw8Nb3Vc6Pd0';" }]);
  assert.equal(token.length, 1, "mixed-case + digits still detected");
  assert.equal(token[0]!.ruleId, "high-entropy-string");
});

test("reports a stable fingerprint across identical scans", () => {
  const file = { path: "a.ts", content: 'k="sk_live_51H8xQh2eZvKYlo2CabcdEFGH"' };
  const a = detectSecrets([file])[0]!;
  const b = detectSecrets([file])[0]!;
  assert.equal(a.fingerprint, b.fingerprint);
});

test("detects an OpenAI project-scoped key (sk-proj-...) as critical", () => {
  // 60 base64url chars after "sk-proj-", well above the 40-char minimum.
  const fakeKey =
    "sk-proj-" +
    "Xk92Lm4Qz7Rt1Yw8Nb3Vc6Pd0" +
    "Xk92Lm4Qz7Rt1Yw8Nb3Vc6Pd0" +
    "Xk92Lm4";
  const findings = detectSecrets([
    { path: "server/openai.ts", content: `const k = "${fakeKey}";` },
  ]);
  const f = findings.find((x) => x.ruleId === "openai-project-key");
  assert.ok(f, "openai project key must be detected");
  assert.equal(f!.provider, "OpenAI");
  assert.equal(f!.severity, "critical");
  assert.ok(!f!.preview.includes("AAAA"), "value must be masked");
});

test("An OpenAI project key is not double-reported as the generic openai-key", () => {
  // Regression for #49: the generic openai-key rule's broader sk-... regex
  // would otherwise also catch project keys and double-report them. The fix
  // is a (?!proj-) negative lookahead on the openai-key rule.
  const fakeKey =
    "sk-proj-" +
    "Q7p2Xz9kLm4Rt1Yw8Nb3Vc6Pd0" +
    "Q7p2Xz9kLm4Rt1Yw8Nb3Vc6Pd0" +
    "Q7p2Xz9";
  const findings = detectSecrets([
    { path: "server/openai.ts", content: `const k = "${fakeKey}";` },
  ]);
  assert.equal(
    findings.filter((x) => x.ruleId === "openai-key").length,
    0,
    "Project key must not be flagged as the generic openai-key",
  );
  assert.equal(
    findings.filter((x) => x.ruleId === "openai-project-key").length,
    1,
    "Project key must be flagged exactly once, as openai-project-key",
  );
});

test("classic OpenAI sk-... key still hits the openai-key rule (not project)", () => {
  // Regression: tightening the openai-key regex with (?!proj-) must not
  // exclude the classic sk-... format.
  const fakeKey = "sk-" + "AbCdEfGh1234_-AbCdEfGh1234_-AbCdEfGh"; // 36 chars after sk-
  const findings = detectSecrets([
    { path: "server/openai.ts", content: `const k = "${fakeKey}";` },
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.ruleId, "openai-key");
  assert.equal(findings[0]!.severity, "high");
});

test("does not flag a too-short sk-proj- string (below the 40-char suffix minimum)", () => {
  // Negative case: prefix is there but the suffix is way too short.
  const findings = detectSecrets([
    { path: "src/example.ts", content: 'const example = "sk-proj-abc123";' },
  ]);
  assert.equal(findings.length, 0, "under-length sk-proj- prefix must not be flagged");
});

test("does not flag a docstring that mentions sk-proj- without a real key", () => {
  // Negative case: the prefix is referenced in prose with no real suffix.
  const findings = detectSecrets([
    {
      path: "docs/openai-setup.md",
      content:
        "// Set OPENAI_API_KEY in your .env. Project keys look like sk-proj-..." +
        " get the value from platform.openai.com/api-keys.",
    },
  ]);
  assert.equal(findings.length, 0, "docstring referencing sk-proj- must not be flagged");
});
