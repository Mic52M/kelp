// Scan execution: build the real connectors for a project and run the scanners
// through the orchestrator, persisting findings. Two entry points share the core
// executeScan(): the queue poller (processOneScan) and a direct run used by the
// connect flow (runScanForProject).

import {
  CONSENT_ACCEPTED_FOR_MULTI_SPECIALIST,
  campaignFindingsToDetected,
  costUsdToCents,
  MONTHLY_CAMPAIGN_CAP_CENTS,
  PlanLimitError,
  assertActivePentestAvailable,
  runActivePentest,
  runScan,
  type ActiveTestConsent,
  type ConsentStore,
  type ScanDeps,
  type ScanMode,
  type SpecialistContext,
  type VulnClass,
} from "@kelp/core";
import {
  claimQueuedScan,
  claimScanById,
  finishScan,
  getCredential,
  getPool,
  loadActiveTestConsent,
  loadOrgPlan,
  loadProject,
  monthToDateCampaignCostCents,
  putCredential,
  resolveMissingFindings,
  upsertFindings,
  writeAudit,
} from "./db.js";
import { createGitHubConnector } from "./connectors/github.js";
import { createSupabaseConnector } from "./connectors/supabase.js";
import { createSupabasePgConnector } from "./connectors/supabase-pg.js";
import { buildCustomerCampaignEntries } from "./agent/customer-backends/index.js";

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
  /** Only set for active_pentest scans (#25/#27). */
  costCents?: number | null;
}

/** Consent adapter around the loadActiveTestConsent helper. */
function consentStoreFromDb(): ConsentStore {
  return {
    async getActiveTestConsent(projectId: string): Promise<ActiveTestConsent | null> {
      const row = await loadActiveTestConsent(projectId);
      if (!row) return null;
      return {
        projectId: row.projectId,
        orgId: row.orgId,
        consented: row.consented,
        consentVersion: row.consentVersion,
        consentedBy: "customer",
        consentedAt: row.consentedAt,
        revokedAt: row.revokedAt,
      };
    },
  };
}

/**
 * Load the two per-project test accounts the active-pentest specialists need.
 * Stored as JSON via putCredential with token_kind = app_test_account_a / _b.
 * Throws if either is missing — the campaign cannot run without both.
 */
async function loadCustomerTestAccounts(projectId: string): Promise<{
  accountA: { email: string; password: string };
  accountB: { email: string; password: string };
}> {
  const [aRaw, bRaw] = await Promise.all([
    getCredential(projectId, "app_test_account_a"),
    getCredential(projectId, "app_test_account_b"),
  ]);
  if (!aRaw || !bRaw) {
    throw new Error(
      "active-pentest requires two stored test accounts (app_test_account_a / _b); connect them in Settings",
    );
  }
  const parse = (raw: string) => JSON.parse(raw) as { email: string; password: string };
  return { accountA: parse(aRaw), accountB: parse(bRaw) };
}

/** Passive (deterministic) scan branch — the pre-#27 behaviour, unchanged. */
async function executePassiveScan(scan: {
  scanId: string;
  orgId: string;
  projectId: string;
  classes: VulnClass[];
}): Promise<ScanOutcome> {
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
    // Prefer the per-project read-only Postgres role (issue #5). Only fall
    // back to the account-level Management API PAT if no connection string
    // is stored — dev/legacy support.
    const connString = await getCredential(scan.projectId, "supabase_readonly_connstring");
    if (connString) {
      deps.supabase = createSupabasePgConnector({ connectionString: connString });
    } else {
      const token = await getCredential(scan.projectId, "supabase_management");
      if (token) deps.supabase = createSupabaseConnector({ managementToken: token });
    }
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

  const erroredClasses = new Set(errors.map((e) => e.vulnClass));
  const successfulClasses = scan.classes.filter((c) => !erroredClasses.has(c));
  await resolveMissingFindings(scan.projectId, scan.scanId, successfulClasses);

  await finishScan(scan.scanId, "succeeded", errors.length ? JSON.stringify(errors) : undefined);
  return { scanId: scan.scanId, found, errors: errors.length };
}

/**
 * Active-pentest branch (#27): dispatch the seven-specialist campaign against
 * the customer's deployed app. Gates: plan tier must allow it (#17), consent
 * must be a valid non-revoked v2 (#24), MTD Claude spend must be under the
 * plan cap (#25), the project must have an `app_base_url` and two stored
 * test accounts. Any failure short-circuits to a `failed` scan with a calm
 * error string — never crashes the worker.
 */
async function executeActivePentestScan(scan: {
  scanId: string;
  orgId: string;
  projectId: string;
  classes: VulnClass[];
}): Promise<ScanOutcome> {
  const project = await loadProject(scan.projectId);
  if (!project) throw new Error(`project ${scan.projectId} not found`);
  if (!project.supabaseRef) {
    throw new Error(
      "The active pen test targets a Supabase-backed project — connect a " +
        "Supabase database from Onboarding first.",
    );
  }

  const plan = await loadOrgPlan(scan.orgId);
  assertActivePentestAvailable(plan);

  const cap = MONTHLY_CAMPAIGN_CAP_CENTS[plan];
  const spent = await monthToDateCampaignCostCents(scan.orgId);
  if (cap > 0 && spent >= cap) {
    throw new PlanLimitError(
      plan,
      "ACTIVE_PENTEST_NOT_AVAILABLE",
      `Monthly active-pentest budget reached ($${(cap / 100).toFixed(2)}). Upgrade for more.`,
    );
  }

  const { accountA, accountB } = await loadCustomerTestAccounts(scan.projectId);

  // Post-#27 Stage A: the customer campaign runs against real Supabase
  // (PostgREST + Auth), so app_base_url is no longer required — it's only
  // relevant once the Stage-B HTTP-endpoint specialists come online.
  const readonlyConnString = await getCredential(scan.projectId, "supabase_readonly_connstring");
  if (!readonlyConnString) {
    throw new Error(
      "The active pen test needs the Supabase read-only connection string " +
        "(Configuration → Supabase — read-only role) to enumerate tables.",
    );
  }
  const [anonKey, managementPat] = await Promise.all([
    getCredential(scan.projectId, "supabase_anon_key"),
    getCredential(scan.projectId, "supabase_management"),
  ]);

  const entries = await buildCustomerCampaignEntries({
    supabaseRef: project.supabaseRef,
    supabaseReadonlyConnString: readonlyConnString,
    supabaseAnonKey: anonKey,
    supabaseManagementPat: managementPat,
    onDiscoveredAnonKey: async (k) => {
      await putCredential(scan.orgId, scan.projectId, "supabase_anon_key", k);
    },
    accountA,
    accountB,
  });

  const ctx: SpecialistContext = {
    orgId: scan.orgId,
    projectId: scan.projectId,
    jobId: scan.scanId,
  };

  const report = await runActivePentest(
    { consent: consentStoreFromDb(), audit: { record: writeAudit } },
    ctx,
    { entries, maxParallel: 4, maxStepsPer: 20 },
    { acceptedVersions: CONSENT_ACCEPTED_FOR_MULTI_SPECIALIST },
  );

  const detected = campaignFindingsToDetected(report.outcomes);
  const found = await upsertFindings(scan.orgId, scan.projectId, scan.scanId, detected);

  const erroredSpecialists = report.outcomes.filter((o) => o.error !== null);
  const erroredClasses = new Set(erroredSpecialists.map((o) => o.vulnClass));
  const successfulClasses = report.outcomes
    .filter((o) => o.error === null)
    .map((o) => o.vulnClass)
    .filter((c) => !erroredClasses.has(c));
  await resolveMissingFindings(scan.projectId, scan.scanId, successfulClasses);

  const costCents = costUsdToCents(report.totalUsage.estimatedCostUsd);
  const errorNote =
    erroredSpecialists.length > 0
      ? JSON.stringify(erroredSpecialists.map((o) => ({ name: o.name, error: o.error })))
      : undefined;
  await finishScan(scan.scanId, "succeeded", errorNote, costCents);

  return {
    scanId: scan.scanId,
    found,
    errors: erroredSpecialists.length,
    costCents,
  };
}

/** Core scan execution against an already-created (running) scan row. */
async function executeScan(scan: {
  scanId: string;
  orgId: string;
  projectId: string;
  classes: VulnClass[];
  mode: ScanMode;
}): Promise<ScanOutcome> {
  try {
    if (scan.mode === "active_pentest") {
      return await executeActivePentestScan(scan);
    }
    return await executePassiveScan(scan);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      await finishScan(scan.scanId, "failed", msg);
    } catch (finishErr) {
      // Belt-and-braces: if finishScan itself blows up (e.g. a pending
      // migration means one of the columns it writes to doesn't exist), we
      // must NOT let the scan stay `running` forever. Fall back to the
      // bare-minimum status flip so the self-heal + UI unstick immediately.
      console.error(
        "finishScan failed after scan error — falling back to bare status update:",
        finishErr instanceof Error ? finishErr.message : finishErr,
      );
      await getPool()
        .query(
          `update scans set status = 'failed', finished_at = now(),
                  error = coalesce(nullif($2, ''), 'Scan errored and finishScan write failed — check worker logs.')
            where id = $1`,
          [scan.scanId, `${msg} [finishScan: ${String(finishErr).slice(0, 160)}]`],
        )
        .catch((bare) => {
          console.error("bare status update also failed:", bare instanceof Error ? bare.message : bare);
        });
    }
    throw e;
  }
}

/** Run a scan directly for a project (creates the scan row, runs it inline). */
export async function runScanForProject(input: {
  orgId: string;
  projectId: string;
  classes: VulnClass[];
  trigger?: "initial" | "manual";
  mode?: ScanMode;
}): Promise<ScanOutcome> {
  const mode: ScanMode = input.mode ?? "passive";
  const { rows } = await getPool().query(
    `insert into scans (org_id, project_id, status, trigger, classes, mode, started_at)
     values ($1, $2, 'running', $3, $4::vuln_class[], $5, now()) returning id`,
    [input.orgId, input.projectId, input.trigger ?? "manual", input.classes, mode],
  );
  return executeScan({
    scanId: rows[0].id,
    orgId: input.orgId,
    projectId: input.projectId,
    classes: input.classes,
    mode,
  });
}

/** Process one queued scan (if any). Used by the worker poll loop. */
export async function processOneScan(): Promise<{ processed: boolean } & Partial<ScanOutcome>> {
  const scan = await claimQueuedScan();
  if (!scan) return { processed: false };
  const outcome = await executeScan(scan);
  return { processed: true, ...outcome };
}

/** Process a specific scan by id (used by the Redis/BullMQ consumer, issue #7).
 *  No-op if the row is no longer 'queued' — makes duplicate delivery safe. */
export async function processScanById(
  scanId: string,
): Promise<{ processed: boolean } & Partial<ScanOutcome>> {
  const scan = await claimScanById(scanId);
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
