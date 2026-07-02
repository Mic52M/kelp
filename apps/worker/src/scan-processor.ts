// Scan processor: claims a queued scan, loads the project + decrypted credentials,
// runs the real scanners through the orchestrator, and persists findings. This is
// the engine the worker runs in a loop (locally: run once or poll).

import { runScan, type ConsentStore, type ScanDeps } from "@kelp/core";
import {
  claimQueuedScan,
  finishScan,
  getCredential,
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

export interface ProcessResult {
  processed: boolean;
  scanId?: string;
  found?: number;
  errors?: number;
}

/** Process one queued scan (if any). Returns processed:false when the queue is empty. */
export async function processOneScan(): Promise<ProcessResult> {
  const scan = await claimQueuedScan();
  if (!scan) return { processed: false };

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
    return { processed: true, scanId: scan.scanId, found, errors: errors.length };
  } catch (e) {
    await finishScan(scan.scanId, "failed", e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/** Drain all currently-queued scans (local dev). */
export async function drainScans(): Promise<void> {
  for (;;) {
    const r = await processOneScan();
    if (!r.processed) break;
    console.log(`  scan ${r.scanId}: ${r.found} finding(s), ${r.errors} error(s)`);
  }
}
