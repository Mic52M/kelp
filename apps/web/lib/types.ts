// View-layer types for the dashboard. These mirror the domain model in
// @kelp/core but are kept local so the web bundle stays free of server-only code.

export type Severity = "critical" | "high" | "medium" | "low";
export type VulnClass = "rls" | "secret" | "bola";
export type FindingStatus =
  | "open"
  | "pr_opened"
  | "needs_review"
  | "confirmed"
  | "resolved";

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
  detectedAt: string;
}

export interface Project {
  id: string;
  name: string;
  repo: string;
  supabaseRef: string;
  lastScan: string;
}
