import { test } from "node:test";
import assert from "node:assert/strict";
import { applySecretFix } from "./secret-fix.js";
import { detectSecrets, locateSecret, type SourceFile } from "../scanners/secrets.js";

const STRIPE_KEY = "sk_live_" + "a1B2c3D4e5F6g7H8i9J0";

function detectOne(file: SourceFile) {
  const findings = detectSecrets([file]);
  assert.equal(findings.length, 1, "expected exactly one finding");
  return findings[0]!;
}

test("locateSecret re-finds a detected secret by fingerprint", () => {
  const file: SourceFile = {
    path: "src/pay.ts",
    content: `const stripe = new Stripe("${STRIPE_KEY}");\n`,
  };
  const finding = detectOne(file);
  const located = locateSecret(file, finding.fingerprint);
  assert.ok(located);
  assert.equal(located.value, STRIPE_KEY);
  assert.equal(file.content.slice(located.index, located.index + 7), "sk_live");
});

test("applySecretFix replaces the quoted literal with process.env", () => {
  const file: SourceFile = {
    path: "src/pay.ts",
    content: `const stripe = new Stripe("${STRIPE_KEY}");\nexport default stripe;\n`,
  };
  const finding = detectOne(file);
  const fix = applySecretFix(file, finding);
  assert.ok(fix);
  assert.equal(fix.envVar, "STRIPE_SECRET_KEY");
  assert.ok(fix.content.includes("new Stripe(process.env.STRIPE_SECRET_KEY)"));
  assert.ok(!fix.content.includes(STRIPE_KEY), "secret must be fully removed");
});

test("applySecretFix replaces every quoted occurrence of the same value", () => {
  const file: SourceFile = {
    path: "lib/config.js",
    content: `const a = '${STRIPE_KEY}';\nconst b = \`${STRIPE_KEY}\`;\n`,
  };
  const finding = detectOne(file); // same value → same fingerprint → one finding
  const fix = applySecretFix(file, finding);
  assert.ok(fix);
  assert.ok(!fix.content.includes(STRIPE_KEY));
  assert.equal(fix.content.match(/process\.env\.STRIPE_SECRET_KEY/g)?.length, 2);
});

test("applySecretFix refuses non-JS files", () => {
  const file: SourceFile = { path: "config.yaml", content: `key: "${STRIPE_KEY}"\n` };
  const finding = detectOne(file);
  assert.equal(applySecretFix(file, finding), null);
});

test("applySecretFix refuses when the secret is embedded in a longer string", () => {
  const file: SourceFile = {
    path: "src/api.ts",
    content: `fetch(url, { headers: { Authorization: "Bearer ${STRIPE_KEY}" } });\n`,
  };
  const finding = detectOne(file);
  assert.equal(applySecretFix(file, finding), null, "partial fixes would still leak");
});

test("applySecretFix returns null when the secret is already gone", () => {
  const withSecret: SourceFile = {
    path: "src/pay.ts",
    content: `const k = "${STRIPE_KEY}";\n`,
  };
  const finding = detectOne(withSecret);
  const fixed: SourceFile = {
    path: "src/pay.ts",
    content: `const k = process.env.STRIPE_SECRET_KEY;\n`,
  };
  assert.equal(applySecretFix(fixed, finding), null);
});
