/**
 * Offline verify for the auth-model exploitability gate. Reproduces the four
 * false-positive shapes Lovable demolished on usatopoint and asserts the
 * runtime gate blocks each one BEFORE it reaches the DB.
 *
 * The fifth Lovable-refuted finding (newsletter INSERT) is a special case:
 * the vuln is real but was mis-classified. Our gate correctly ALLOWS the
 * finding when the evidence names downstream harm (spam/enumeration) — the
 * severity/class judgment stays with triage. We assert both paths here:
 * naked "anon INSERT" → refused; "anon INSERT enables spam enumeration"
 * → allowed through to triage.
 *
 * Run: `npm run verify:auth-model -w @kelp/worker`
 */

import assert from "node:assert/strict";
import {
  buildAuthModelBrief,
  checkExploitability,
  type SourceFile,
} from "@kelp/core";

function file(path: string, content: string): SourceFile {
  return { path, content };
}

async function main() {
  // A minimal Supabase / Lovable-style app: wildcard CORS, no Set-Cookie
  // anywhere, no Allow-Credentials. Exactly the shape usatopoint has.
  const model = buildAuthModelBrief([
    file(
      "supabase/functions/_shared/cors.ts",
      'export const corsHeaders = { "Access-Control-Allow-Origin": "*" };',
    ),
    file(
      "supabase/functions/place-order/index.ts",
      "const { data: products } = await admin.from('products').select('id, price');",
    ),
    file(
      "supabase/functions/handle-email-unsubscribe/index.ts",
      "await admin.from('email_unsubscribe_tokens').select('*').eq('used_at', null);",
    ),
  ]);

  assert.equal(model.primaryAuthMode, "bearer_jwt", "auth model must be bearer_jwt");
  assert.equal(model.corsAllowsCredentials, false, "no Allow-Credentials must be detected");
  console.log("✓ auth model classified: bearer_jwt, no credentials, no cookies");
  console.log("  serverSidePriceRecalcHints:", model.serverSidePriceRecalcHints);
  console.log("  oneTimeTokenTables:", model.oneTimeTokenTables);

  // ── FP #1: CSRF in place-order ────────────────────────────────────────
  {
    const reason = checkExploitability(
      {
        vulnClass: "auth",
        severity: "high",
        title: "CSRF in place-order endpoint allows guest order placement",
        evidence:
          "The place-order endpoint accepts POST from any origin with no " +
          "CSRF token, verify_jwt=false, and silent auth failure — cross-" +
          "origin attacker can submit orders.",
      },
      model,
    );
    assert.ok(reason, "CSRF finding must be refused on bearer-JWT app");
    console.log("\n✓ FP #1 (CSRF on place-order) refused at the gate");
    console.log("  reason:", reason?.slice(0, 140), "…");
  }

  // ── FP #2: CORS get-user-roles HIGH ───────────────────────────────────
  {
    const reason = checkExploitability(
      {
        vulnClass: "exposure",
        severity: "high",
        title: "Permissive CORS with Sensitive Role Data Exposure in get-user-roles",
        evidence:
          "The endpoint returns Access-Control-Allow-Origin: * with role " +
          "data (roles array) — cross-origin sites could read the response.",
      },
      model,
    );
    assert.ok(reason, "CORS at high severity must be refused without Allow-Credentials or named secret");
    console.log("\n✓ FP #2 (CORS get-user-roles high) refused at the gate");
    console.log("  reason:", reason?.slice(0, 140), "…");
  }

  // ── FP #4/#5: Wildcard CORS medium on multiple functions ──────────────
  {
    const reason = checkExploitability(
      {
        vulnClass: "exposure",
        severity: "medium",
        title: "Permissive CORS Headers on Multiple Edge Functions",
        evidence:
          "Multiple edge functions return Access-Control-Allow-Origin: * — " +
          "violates least-privilege principle.",
      },
      model,
    );
    assert.ok(reason, "Wildcard CORS at medium must be refused without Allow-Credentials");
    console.log("\n✓ FP #4/#5 (wildcard CORS medium) refused at the gate");
    console.log("  reason:", reason?.slice(0, 140), "…");
  }

  // ── Same finding, severity=low → PASSES (hardening) ───────────────────
  {
    const reason = checkExploitability(
      {
        vulnClass: "exposure",
        severity: "low",
        title: "Permissive CORS Headers on Multiple Edge Functions",
        evidence: "Wildcard CORS across the edge fleet — hardening.",
      },
      model,
    );
    assert.equal(reason, null, "Same finding at severity=low must pass — hardening is fine");
    console.log("\n✓ Same CORS finding at severity=low → ALLOWED (hardening path preserved)");
  }

  // ── FP #3 (partial): Newsletter INSERT naked → refused ────────────────
  {
    const reason = checkExploitability(
      {
        vulnClass: "rls",
        severity: "medium",
        title: "Anonymous Newsletter Subscriber Insert",
        evidence: "Anon users can INSERT into newsletter_subscribers.",
      },
      model,
    );
    assert.ok(reason, "Naked anon-INSERT without downstream harm must be refused");
    console.log("\n✓ Naked anon-INSERT finding refused at the gate");
    console.log("  reason:", reason?.slice(0, 140), "…");
  }

  // ── Same finding WITH downstream harm evidence → ALLOWED to triage ────
  {
    const reason = checkExploitability(
      {
        vulnClass: "rls",
        severity: "medium",
        title: "Anonymous Newsletter Subscriber Spam / Enumeration",
        evidence:
          "Anon INSERT allows arbitrary emails without consent — spam and " +
          "enumeration primitive: attacker can subscribe victims and probe " +
          "for existing rows via 409 conflict responses.",
      },
      model,
    );
    assert.equal(reason, null, "Anon-INSERT with named harm must pass to triage");
    console.log("\n✓ Anon-INSERT WITH downstream harm evidence → ALLOWED to triage");
  }

  // ── Sanity: a real cross-account RLS finding passes untouched ─────────
  {
    const reason = checkExploitability(
      {
        vulnClass: "rls",
        severity: "high",
        title: "Cross-account read on orders table",
        evidence:
          "AccountA read three rows owned by accountB by removing the RLS " +
          "filter on GET /rest/v1/orders. Returned rows contain accountB's " +
          "shipping addresses.",
      },
      model,
    );
    assert.equal(reason, null, "Real cross-account RLS finding must pass untouched");
    console.log("\n✓ Real cross-account RLS finding → ALLOWED");
  }

  console.log("\nauth-model verify: PASS — 4/4 usatopoint false positives blocked at the gate.");
}

main().catch((e) => {
  console.error("auth-model verify: FAIL");
  console.error(e);
  process.exit(1);
});
