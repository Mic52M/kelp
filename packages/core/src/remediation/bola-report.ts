// Builds the human-review report for a BOLA probe result.
//
// In the MVP we do NOT auto-fix BOLA (too business-specific) — we produce a
// report that the Kelp team validates before it is shown to the customer as
// "confirmed". Critically, the report proves the flaw WITHOUT exposing the real
// data of the third-party account: we describe the resource abstractly and never
// include its field values.

import type { Severity } from "../types.js";
import { fingerprint } from "../fingerprint.js";

export interface BolaProbeResult {
  endpoint: string; // e.g. "GET /rest/v1/invoices?id=eq.{id}"
  resourceKind: string; // e.g. "invoice"
  /** true if account A could access a resource owned by account B */
  crossAccountAccess: boolean;
  /** which parameter was manipulated, e.g. "id" */
  parameter: string;
}

export interface BolaReport {
  fingerprint: string;
  severity: Severity;
  status: "needs_review";
  title: string;
  endpoint: string;
  /** proof described abstractly — no third-party field values */
  evidence: string;
  remediation: string;
}

export function buildBolaReport(probe: BolaProbeResult): BolaReport | null {
  if (!probe.crossAccountAccess) return null; // no finding if access was denied

  return {
    fingerprint: fingerprint(["bola", probe.endpoint, probe.parameter]),
    severity: "high",
    status: "needs_review",
    title: `A user can access another user's ${probe.resourceKind} by ${probe.parameter}`,
    endpoint: probe.endpoint,
    evidence:
      `Using test account A's session, Kelp changed the "${probe.parameter}" value ` +
      `on ${probe.endpoint} and received a ${probe.resourceKind} that belongs to test ` +
      `account B. Object-level authorization is not enforced. ` +
      `(The other account's data is not shown here.)`,
    remediation:
      `Enforce that the requester owns the ${probe.resourceKind}. On Supabase this ` +
      `usually means an RLS policy that checks auth.uid() against the owner column, ` +
      `or an authorization check in your API layer before returning the row. This ` +
      `finding is queued for review by the Kelp team before it is marked confirmed.`,
  };
}
