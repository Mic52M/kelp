// Turns a queued ScanJob into a completed scan by invoking the core orchestrator
// with the injected connectors, then hands the normalized findings to a sink
// (in production: upsert into the findings table, keyed by fingerprint, and mark
// regressions). Here the sink is a callback so it stays testable.

import { runScan, type ScanDeps, type DetectedFinding } from "@kelp/core";
import type { ScanJob } from "./queue.js";

export interface ScanConnectors {
  deps: ScanDeps;
}

export async function processScanJob(
  job: ScanJob,
  { deps }: ScanConnectors,
  onFindings: (findings: DetectedFinding[]) => Promise<void> | void,
): Promise<{ found: number; errors: number }> {
  const { findings, errors } = await runScan(
    {
      orgId: job.orgId,
      projectId: job.projectId,
      repoFullName: job.repoFullName,
      supabaseRef: job.supabaseRef,
      classes: job.classes,
      jobId: job.id,
    },
    deps,
  );

  await onFindings(findings);

  for (const e of errors) {
    console.warn(`  [warn] ${e.vulnClass} check did not complete: ${e.message}`);
  }
  return { found: findings.length, errors: errors.length };
}
