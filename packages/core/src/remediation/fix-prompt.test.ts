import { test } from "node:test";
import assert from "node:assert/strict";
import { fixPromptForSecret, fixPromptForRls, fixPromptForBola } from "./fix-prompt.js";
import type { SecretFinding } from "../scanners/secrets.js";
import type { RlsFinding } from "../scanners/rls.js";
import type { BolaReport } from "./bola-report.js";

const secret: SecretFinding = {
  fingerprint: "f1",
  ruleId: "supabase-service-role",
  provider: "Supabase",
  title: "Supabase service_role key",
  severity: "critical",
  path: "src/lib/supabase.ts",
  line: 12,
  preview: "eyJh…ture",
  clientSide: true,
  confidence: "high",
};

test("secret fix prompt names the tool, env var, and rotation for critical", () => {
  const p = fixPromptForSecret(secret, "lovable");
  assert.match(p, /Paste this into Lovable/);
  assert.match(p, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(p, /src\/lib\/supabase\.ts/);
  assert.match(p, /rotate the Supabase key/);
  assert.ok(!p.includes("eyJhbGci"), "must not include the secret value");
});

test("non-critical secret prompt omits rotation", () => {
  const p = fixPromptForSecret({ ...secret, ruleId: "stripe-secret-test", provider: "Stripe", severity: "high" }, "cursor");
  assert.match(p, /STRIPE_SECRET_KEY/);
  assert.ok(!/rotate/i.test(p));
});

test("generic tool uses a neutral label", () => {
  const p = fixPromptForSecret(secret);
  assert.match(p, /your AI coding assistant/);
});

const rls: RlsFinding = {
  fingerprint: "r1",
  issue: "rls_disabled",
  severity: "critical",
  schema: "public",
  table: "bookings",
  title: 'RLS off on "bookings"',
  explanation: "…",
  ownershipColumn: "user_id",
  fixable: true,
};

test("RLS fix prompt embeds the migration when fixable", () => {
  const p = fixPromptForRls(rls, "bolt");
  assert.match(p, /Paste this into Bolt/);
  assert.match(p, /enable row level security/);
  assert.match(p, /auth\.uid\(\)\) = "user_id"/);
});

test("RLS fix prompt asks for the owner column when not inferable", () => {
  const p = fixPromptForRls({ ...rls, ownershipColumn: null, fixable: false });
  assert.match(p, /which column identifies the owner/);
  assert.ok(!/enable row level security/.test(p));
});

test("BOLA fix prompt references the endpoint and an ownership check", () => {
  const report: BolaReport = {
    fingerprint: "b1",
    severity: "high",
    status: "needs_review",
    title: "…",
    endpoint: "GET /rest/v1/invoices?id=eq.{id}",
    evidence: "…",
    remediation: "…",
  };
  const p = fixPromptForBola(report, "v0");
  assert.match(p, /Paste this into v0/);
  assert.match(p, /\/rest\/v1\/invoices/);
  assert.match(p, /auth\.uid\(\)/);
});
