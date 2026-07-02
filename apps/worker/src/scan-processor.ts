// Scan execution: build the real connectors for a project and run the scanners
// through the orchestrator, persisting findings. Two entry points share the core
// executeScan(): the queue poller (processOneScan) and a direct run used by the
// connect flow (runScanForProject).

import { runScan, type ConsentStore, type ScanDeps, type VulnClass } from "@kelp/core";
import {
  claimQueuedScan,
  finishScan,
  getCredential,
  getPool,
  loadProject,
  upsertFindings,
  writeAudit,
} from "./db.js";
import { createGitHubConnector } from "./connectors/github.js";
import { createSupabaseConnector } from "./connectors/supabase.js";

const noConsent: ConsentStore = { getActiveTestConsent: async () => null };

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

export interface ScanOutcome {
  scanId: string;
  found: number;
  errors: number;
}

/** Core scan execution against an already-created (running) scan row. */
async function executeScan(scan: {
  scanId: string;
  orgId: string;
  projectId: string;
  classes: VulnClass[];
}): Promise<ScanOutcome> {
  try {
    const project = await loadProject(scan.projectId);
    if (!project) throw new Error(`project ${scan.projectId} not found`);

    const deps: ScanDeps = { consent: noConsent, audit: { record: writeAudit } };

    if (project.repoFullName && project.installationId != null) {
      deps.github = createGitHubConnector({
        appId: requireEnv("GITHUB_APP_ID"),
        privateKey: Buffer.from(requireEnv("GITHUB_APP_PRIVATE_KEY_BASE64"), "base64").toString("utf8"),
        installationId: project.installationId,
      });
    }
    if (project.supabaseRef) {
      const token = await getCredential(scan.projectId, "supabase_management");
      if (token) deps.supabase = createSupabaseConnector({ managementToken: token });
    }

    const { findings, errors } = await runScan(
      {
        orgId: scan.orgId,
        projectId: scan.projectId,
        repoFullName: project.repoFullName,
        supabaseRef: project.supabaseRef,
        classes: scan.classes,
        jobId: scan.scanId,
      },
      deps,
    );

    const found = await upsertFindings(scan.orgId, scan.projectId, scan.scanId, findings);
    await finishScan(scan.scanId, "succeeded", errors.length ? JSON.stringify(errors) : undefined);
    return { scanId: scan.scanId, found, errors: errors.length };
  } catch (e) {
    await finishScan(scan.scanId, "failed", e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/** Run a scan directly for a project (creates the scan row, runs it inline). */
export async function runScanForProject(input: {
  orgId: string;
  projectId: string;
  classes: VulnClass[];
  trigger?: "initial" | "manual";
}): Promise<ScanOutcome> {
  const { rows } = await getPool().query(
    `insert into scans (org_id, project_id, status, trigger, classes, started_at)
     values ($1, $2, 'running', $3, $4::vuln_class[], now()) returning id`,
    [input.orgId, input.projectId, input.trigger ?? "manual", input.classes],
  );
  return executeScan({
    scanId: rows[0].id,
    orgId: input.orgId,
    projectId: input.projectId,
    classes: input.classes,
  });
}

/** Process one queued scan (if any). Used by the worker poll loop. */
export async function processOneScan(): Promise<{ processed: boolean } & Partial<ScanOutcome>> {
  const scan = await claimQueuedScan();
  if (!scan) return { processed: false };
  const outcome = await executeScan(scan);
  return { processed: true, ...outcome };
}

/** Drain all currently-queued scans (local dev / poll loop tick). */
export async function drainScans(): Promise<void> {
  for (;;) {
    const r = await processOneScan();
    if (!r.processed) break;
    console.log(`  scan ${r.scanId}: ${r.found} finding(s), ${r.errors} error(s)`);
  }
}
