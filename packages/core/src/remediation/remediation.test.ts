import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSecretPr } from "./secret-pr.js";
import { buildBolaReport } from "./bola-report.js";
import type { SecretFinding } from "../scanners/secrets.js";

const secret: SecretFinding = {
  fingerprint: "abcd1234ef567890",
  ruleId: "supabase-service-role",
  provider: "Supabase",
  title: "Supabase service_role key (full DB access)",
  severity: "critical",
  path: "src/lib/supabase.ts",
  line: 12,
  preview: "eyJh…ture",
  clientSide: true,
  confidence: "high",
};

test("secret PR maps rule to the right env var and never leaks the value", () => {
  const pr = generateSecretPr(secret);
  assert.equal(pr.envVar, "SUPABASE_SERVICE_ROLE_KEY");
  assert.match(pr.branch, /^kelp\/remove-secret-supabase-abcd1234$/);
  assert.match(pr.body, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(pr.body, /Rotate this key now/); // critical → rotation guidance
  assert.ok(!pr.body.includes("eyJhbGci"), "must not contain a real secret");
});

test("non-critical secret PR omits the urgent rotation line", () => {
  const pr = generateSecretPr({ ...secret, ruleId: "stripe-secret-test", provider: "Stripe", severity: "high" });
  assert.equal(pr.envVar, "STRIPE_SECRET_KEY");
  assert.ok(!/Rotate this key now/.test(pr.body));
});

test("BOLA report is produced only when cross-account access happened", () => {
  const denied = buildBolaReport({
    endpoint: "GET /x",
    resourceKind: "order",
    crossAccountAccess: false,
    parameter: "id",
  });
  assert.equal(denied, null);

  const hit = buildBolaReport({
    endpoint: "GET /rest/v1/invoices?id=eq.{id}",
    resourceKind: "invoice",
    crossAccountAccess: true,
    parameter: "id",
  });
  assert.ok(hit);
  assert.equal(hit!.status, "needs_review");
  assert.match(hit!.evidence, /not shown here/i); // no third-party data
});
