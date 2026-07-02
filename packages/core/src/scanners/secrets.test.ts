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

test("reports a stable fingerprint across identical scans", () => {
  const file = { path: "a.ts", content: 'k="sk_live_51H8xQh2eZvKYlo2CabcdEFGH"' };
  const a = detectSecrets([file])[0]!;
  const b = detectSecrets([file])[0]!;
  assert.equal(a.fingerprint, b.fingerprint);
});
