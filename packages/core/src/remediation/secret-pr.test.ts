import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSecrets, type SourceFile, type SecretFinding } from "../scanners/secrets.js";
import { generateSecretPr, isPatchable, suggestedEnvVar } from "./secret-pr.js";

const STRIPE_KEY = "sk_live_" + "a1B2c3D4e5F6g7H8i9J0";

function detectOne(file: SourceFile): SecretFinding {
  const findings = detectSecrets([file]);
  assert.equal(findings.length, 1, "expected exactly one finding");
  return findings[0]!;
}

test("generateSecretPr: branch is kelp/fix-<fingerprint>", () => {
  // Per #47 spec: branch must be kelp/fix-<fingerprint> so the closure
  // path on PR merge can identify the finding.
  const f = detectOne({
    path: "src/pay.ts",
    content: `const stripe = new Stripe("${STRIPE_KEY}");\n`,
  });
  const meta = generateSecretPr(f);
  assert.equal(meta.branch, `kelp/fix-${f.fingerprint}`);
});

test("generateSecretPr: Kelp-Finding trailer appears in PR body and commit", () => {
  // The trailer is the linchpin of the fingerprint-closure path (#47).
  // It must appear in BOTH places (PR body is primary, commit is fallback).
  const f = detectOne({
    path: "src/pay.ts",
    content: `const k = "${STRIPE_KEY}";\n`,
  });
  const meta = generateSecretPr(f);
  const expectedTrailer = `Kelp-Finding: ${f.fingerprint}`;
  assert.ok(
    meta.body.includes(expectedTrailer),
    "PR body must carry the Kelp-Finding trailer",
  );
  assert.ok(
    meta.commitMessage.includes(expectedTrailer),
    "commit message must carry the Kelp-Finding trailer",
  );
});

test("generateSecretPr: PR body has all six spec sections", () => {
  // What / Why / How Kelp verified / Rollback / Before merging / trailer.
  const f = detectOne({
    path: "src/pay.ts",
    content: `const k = "${STRIPE_KEY}";\n`,
  });
  const body = generateSecretPr(f).body;
  assert.match(body, /^## What\b/m, "must have ## What");
  assert.match(body, /^## Why\b/m, "must have ## Why");
  assert.match(body, /^## How Kelp verified this\b/m, "must have ## How Kelp verified this");
  assert.match(body, /^## Rollback\b/m, "must have ## Rollback");
  assert.match(body, /^## Before merging\b/m, "must have ## Before merging");
  assert.match(body, /^Kelp-Finding: /m, "must end with Kelp-Finding trailer");
});

test("generateSecretPr: PR body names the severity + class + masked value", () => {
  // The spec calls for class + severity + plain-English. We surface all three
  // explicitly so a reviewer knows what they're approving.
  const f = detectOne({
    path: "src/pay.ts",
    content: `const k = "${STRIPE_KEY}";\n`,
  });
  const body = generateSecretPr(f).body;
  assert.ok(body.includes(f.severity), "body must include severity");
  assert.ok(body.includes("secret"), "body must include the vuln class");
  assert.ok(body.includes(f.preview), "body must include the masked preview");
  // Must NOT include the raw secret value.
  assert.ok(!body.includes(STRIPE_KEY), "body must never include the raw secret");
});

test("generateSecretPr: critical secrets get the rotation callout", () => {
  const f = detectOne({
    path: "src/pay.ts",
    content: `const k = "${STRIPE_KEY}";\n`,
  });
  // STRIPE live is critical. Body should include the "rotate this key" callout.
  const body = generateSecretPr(f).body;
  assert.equal(f.severity, "critical");
  assert.ok(/Rotate this key now/i.test(body), "critical must include the rotation callout");
});

test("isPatchable: ok=true for high-confidence secret findings", () => {
  const r = isPatchable({ vuln_class: "secret", confidence: "high" });
  assert.deepEqual(r, { ok: true });
});

test("isPatchable: rejects non-secret vuln classes with a reason", () => {
  // RLS, BOLA, exposure, etc. need either a DB-side change or a human
  // authored fix. The UI uses the reason as the disabled-button tooltip.
  const r = isPatchable({ vuln_class: "rls", confidence: "high" });
  assert.equal(r.ok, false);
  if (r.ok === false) {
    assert.ok(r.reason.length > 0, "reason must be non-empty so the UI can render it");
  }
});

test("isPatchable: rejects medium-confidence secrets with a reason", () => {
  // The secret scanner assigns confidence=medium to generic high-entropy
  // strings (vs. branded provider keys at high). We don't auto-PR those.
  const r = isPatchable({ vuln_class: "secret", confidence: "medium" });
  assert.equal(r.ok, false);
  if (r.ok === false) {
    assert.ok(r.reason.length > 0, "reason must be non-empty");
  }
});

test("suggestedEnvVar: maps known rules to known env names", () => {
  assert.equal(suggestedEnvVar("stripe-secret-live"), "STRIPE_SECRET_KEY");
  assert.equal(suggestedEnvVar("openai-key"), "OPENAI_API_KEY");
  assert.equal(suggestedEnvVar("supabase-service-role"), "SUPABASE_SERVICE_ROLE_KEY");
  assert.equal(suggestedEnvVar("not-a-real-rule"), "SECRET_VALUE");
});