// Client-safe surface: whether Kelp can auto-open a fix PR for a finding.
//
// Extracted from secret-pr.ts so the browser bundle can import it without
// pulling the whole remediation module (which transitively pulls in crypto
// and other Node built-ins). The server side re-exports these from
// secret-pr.ts so nothing on the backend has to change.

/**
 * Result of {@link isPatchable}. The UI uses `reason` to render a tooltip
 * when the "Open fix PR" button is disabled (issue #47).
 */
export type Patchability =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Single source of truth for whether Kelp can open an automatic fix PR for
 * a finding. Today only high-confidence exposed-secret findings are
 * patchable; other vuln classes need either a DB-side change (RLS, GRANTs)
 * or a human-authored fix that we don't want to automate.
 *
 * The decision lives here, not in the worker, so the UI can call it too and
 * gate the button with the same reasoning the backend enforces.
 */
export function isPatchable(finding: {
  vuln_class: string;
  confidence?: "high" | "medium";
}): Patchability {
  if (finding.vuln_class !== "secret") {
    return {
      ok: false,
      reason:
        "Only exposed-secret findings have an automatic code-side fix. " +
        "Use the copy prompt for other classes.",
    };
  }
  if (finding.confidence !== "high") {
    return {
      ok: false,
      reason:
        "Kelp isn't confident enough to auto-fix this one. " +
        "Use the copy prompt and review manually.",
    };
  }
  return { ok: true };
}
