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

/** "How Kelp verified this" (#43) — data backing the evidence panel. All
 *  optional so the panel can render gracefully for older findings that
 *  predate a given field, or for lanes without an agent transcript. */
export interface FindingEvidence {
  /** Detection lane — informs the panel's phrasing.
   *   - "agent": autonomous specialist proved it via a re-runnable probe.
   *   - "passive-secret": deterministic secret-scanner match.
   *   - "passive-rls": deterministic RLS/PostgREST audit.
   *   - "generic": unknown or hand-filed. */
  kind: "agent" | "passive-secret" | "passive-rls" | "generic";
  /** Which Supabase surface the agent attacked (postgrest / edge / auth / …). */
  surface?: string;
  /** endpoint / table / function the finding is about */
  endpoint?: string;
  /** what the executor observed that let it accept the finding — the
   *  "[Kelp confirmed: …]" tail on the persisted evidence string. */
  confirmedWhy?: string;
  /** For passive-secret: the rule id (e.g. "stripe-secret-live"). */
  ruleId?: string;
  /** For passive-secret: the provider (e.g. "Stripe"). */
  provider?: string;
  /** For passive-secret: masked preview shown by the scanner. */
  preview?: string;
  /** Trimmed transcript slice from the specialist that filed this finding.
   *  Response bodies were already redacted by the toolbox — transcripts hold
   *  only the agent's narration + tool-choice reasoning, no user data. */
  transcript?: string[];
  /** Name of the specialist whose transcript we're showing (e.g. "agent-postgrest"). */
  specialist?: string;
}

export interface Finding {
  id: string;
  vulnClass: VulnClass;
  severity: Severity;
  status: FindingStatus;
  title: string;
  location: string;
  explanation: string;
  /** "How Kelp verified this" (#43). */
  evidence?: FindingEvidence;
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
  /** true iff the most recent scan re-detected (or freshly filed) this
   *  finding — used on Overview to split "This scan" vs "Previous scans". */
  fromLatestScan: boolean;
  detectedAt: string;
}

export interface Project {
  id: string;
  name: string;
  repo: string;
  supabaseRef: string;
  lastScan: string;
}
