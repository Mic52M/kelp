// Normalise the class-specific Report each specialist returns into the
// generic DetectedFinding shape the DB layer already knows how to persist
// (#27). Every specialist's Report carries `fingerprint`, `severity`,
// `title`, and an `evidence` string — the rest of the fields differ by
// class and land in the jsonb `raw` payload untouched.
//
// Keeping the mapper in core (not in the worker) so unit tests can cover
// it without pulling in pg, and so any future non-HTTP campaign target
// (e.g. a scheduled MCP server) can reuse it.

import type { DetectedFinding } from "../orchestrator.js";
import type { Severity, VulnClass } from "../types.js";

/** Shared shape every specialist Report satisfies at minimum. */
interface MinSpecialistReport {
  fingerprint: string;
  severity: Severity;
  title: string;
  evidence: string;
  /** endpoint or table — whichever the specialist reports on */
  endpoint?: string;
  table?: string;
  [k: string]: unknown;
}

/** One outcome from a campaign, as returned by the orchestrator. */
export interface CampaignOutcomeLike {
  name: string;
  vulnClass: VulnClass;
  findings: readonly unknown[];
}

/**
 * Turn a campaign's outcomes into DetectedFinding rows. `location` picks the
 * best-fit identifier the class exposes (endpoint for HTTP-shaped specialists,
 * table for RLS-deep). `fixable: false` — active-pentest findings always go
 * through human review (`needs_review`) before any auto-fix would apply.
 */
export function campaignFindingsToDetected(
  outcomes: readonly CampaignOutcomeLike[],
): DetectedFinding[] {
  const detected: DetectedFinding[] = [];
  for (const outcome of outcomes) {
    for (const raw of outcome.findings) {
      const report = raw as MinSpecialistReport;
      const location =
        typeof report.endpoint === "string"
          ? report.endpoint
          : typeof report.table === "string"
            ? report.table
            : null;
      detected.push({
        vulnClass: outcome.vulnClass,
        severity: report.severity,
        fingerprint: report.fingerprint,
        title: report.title,
        explanation: report.evidence,
        location,
        fixable: false,
        raw: report,
      });
    }
  }
  return detected;
}
