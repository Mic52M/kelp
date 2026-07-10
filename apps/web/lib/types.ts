// View-layer types for the dashboard. These mirror the domain model in
// @kelp/core but are kept local so the web bundle stays free of server-only code.

export type Severity = "critical" | "high" | "medium" | "low";
export type VulnClass =
  | "rls"
  | "secret"
  | "bola"
  | "auth"
  | "injection"
  | "ssrf"
  | "exposure";
export type FindingStatus =
  | "open"
  | "pr_opened"
  | "needs_review"
  | "confirmed"
  | "resolved";

/** Triage annotation (#29) — set when Kelp's post-review triage touched a
 *  finding. Surfaced in the UI so the user sees WHY a finding was downgraded
 *  or reclassified, and can trust the label. */
export interface FindingTriage {
  action: "keep" | "downgrade_to_needs_review" | "reclassify";
  reason: string;
  originalVulnClass?: VulnClass;
  originalSeverity?: Severity;
}

export interface Finding {
  id: string;
  vulnClass: VulnClass;
  severity: Severity;
  status: FindingStatus;
  title: string;
  location: string;
  explanation: string;
  /** what the user should do, in plain language */
  remediation: string;
  /** for RLS: the proposed migration; for secret: the PR summary */
  fixPreview?: string;
  /** paste-ready prompt for the user's AI coding tool (Kelp's wedge) */
  fixPrompt?: string;
  /** end-user PII exposure — category + count only, never raw values */
  exposure?: { category: string; count: number }[];
  /** URL of the fix PR Kelp opened (secret findings) */
  prUrl?: string;
  /** true when Kelp can safely open an automatic fix PR (high-confidence secrets) */
  autofixable?: boolean;
  /** triage annotation, when Kelp's post-review pass touched this finding */
  triage?: FindingTriage;
  detectedAt: string;
}

export interface Project {
  id: string;
  name: string;
  repo: string;
  supabaseRef: string;
  lastScan: string;
}
