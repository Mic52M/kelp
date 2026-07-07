// Shared domain types. Mirror the SQL enums in packages/db/migrations/0001_init.sql.
// Keep these two in sync — the SQL is the source of truth.

export type PlanTier = "free" | "starter" | "agency";
export type MemberRole = "owner" | "admin" | "member";

export type VulnClass = "rls" | "secret" | "bola" | "auth" | "injection" | "ssrf" | "exposure";
export type Severity = "critical" | "high" | "medium" | "low";

export type FindingStatus =
  | "open"
  | "pr_opened"
  | "needs_review"
  | "confirmed"
  | "resolved"
  | "regressed"
  | "dismissed";

export type ScanStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";
export type ScanTrigger = "initial" | "manual" | "webhook_push" | "scheduled";
/**
 * Distinguishes deterministic scans (regex/schema/static analysis) from
 * multi-specialist Claude-driven campaigns. Persisted on scans.mode (#27).
 */
export type ScanMode = "passive" | "active_pentest";

export type RemediationKind = "rls_migration" | "secret_pr" | "bola_review";
export type RemediationStatus =
  | "proposed"
  | "pr_opened"
  | "applied"
  | "rejected"
  | "superseded";

export interface Project {
  id: string;
  orgId: string;
  name: string;
  githubRepoFullName: string | null;
  githubInstallationId: number | null;
  supabaseProjectRef: string | null;
  /** Customer's deployed app URL; required for active_pentest scans (#27). */
  appBaseUrl: string | null;
}

/** Current active-test consent for a project (see active_test_consents). */
export interface ActiveTestConsent {
  projectId: string;
  orgId: string;
  consented: boolean;
  consentVersion: string;
  consentedBy: string;
  consentedAt: Date;
  revokedAt: Date | null;
}

export interface Finding {
  id: string;
  orgId: string;
  projectId: string;
  vulnClass: VulnClass;
  severity: Severity;
  status: FindingStatus;
  fingerprint: string;
  title: string;
  explanation: string;
  location: string | null;
}
