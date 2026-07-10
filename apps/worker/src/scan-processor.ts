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
  discoverEdgeFunctions,
  parseRepoSchema,
  detectSupabaseConfig,
  reviewCampaign,
  runFollowup,
  triageCampaign,
  applyTriage,
  summarizeTriage,
  runActivePentest,
  runScan,
  type ActiveTestConsent,
  type ConsentStore,
  type ScanDeps,
  type ScanMode,
  type SpecialistContext,
  type VulnClass,
  type DiscoveredEdgeFunction,
  type TableIntel,
  type CampaignReport,
  type Lead,
  type PentestTools,
  type SpecialistOutcome,
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
import { buildAutonomousCampaign } from "./agent/autonomous-campaign.js";
import { selectPentestSource } from "./agent/pentest-source.js";

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
  // NOTE: we do NOT require project.supabaseRef here — it's resolved below from
  // the connected repo (Lovable Cloud & repo-only connects have no stored ref
  // until the first scan). The real reachability check happens after recon.

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

  const [storedConnString, storedAnonKey, managementPat, serviceRoleKey] = await Promise.all([
    getCredential(scan.projectId, "supabase_readonly_connstring"),
    getCredential(scan.projectId, "supabase_anon_key"),
    getCredential(scan.projectId, "supabase_management"),
    getCredential(scan.projectId, "supabase_service_role"),
  ]);

  // Recon inputs for the autonomous agents: the app's source (edge functions,
  // config, helpers) + the edge-function list (for the destructive block-list)
  // + repo-derived schema/RLS + repo-detected Supabase config. This is what
  // makes a Lovable-Cloud project — no DB access, no service_role — scannable:
  // everything comes from the connected repo.
  let edgeFunctions: DiscoveredEdgeFunction[] = [];
  let sourceFiles: Awaited<ReturnType<ReturnType<typeof createGitHubConnector>["listSourceFiles"]>> = [];
  let repoSchema: TableIntel[] = [];
  let repoConfig: ReturnType<typeof detectSupabaseConfig> = null;
  if (project.repoFullName && project.installationId != null) {
    try {
      const github = createGitHubConnector({
        appId: requireEnv("GITHUB_APP_ID"),
        privateKey: Buffer.from(requireEnv("GITHUB_APP_PRIVATE_KEY_BASE64"), "base64").toString("utf8"),
        installationId: project.installationId,
      });
      const allFiles = await github.listSourceFiles(project.repoFullName);
      edgeFunctions = discoverEdgeFunctions(allFiles);
      repoSchema = parseRepoSchema(allFiles);
      repoConfig = detectSupabaseConfig(allFiles);
      // Hand the agents only the security-relevant backend source — not the
      // hundreds of UI/doc files that would bury the attack surface and burn
      // their step budget before they reach config.toml / edge functions.
      sourceFiles = selectPentestSource(allFiles);
      console.log(
        `repo recon: ${allFiles.length} files → ${sourceFiles.length} relevant, ` +
          `${edgeFunctions.length} edge fns, ${repoSchema.length} tables, ` +
          `config ${repoConfig ? "detected" : "not found"}`,
      );
    } catch (e) {
      console.warn("repo recon failed:", e instanceof Error ? e.message : e);
    }
  }

  // Resolve the Supabase ref + anon key from the project, stored creds, or the
  // repo — in that order. The repo path is what unlocks managed-Supabase.
  const supabaseRef = project.supabaseRef || repoConfig?.ref || "";
  const anonKey = storedAnonKey || repoConfig?.anonKey || null;

  // Persist a freshly repo-detected anon key so Configuration shows it as
  // "detected" for projects connected before auto-detect existed. Never
  // overwrites a user-set one.
  if (!storedAnonKey && repoConfig?.anonKey) {
    await putCredential(scan.orgId, scan.projectId, "supabase_anon_key", repoConfig.anonKey).catch(() => {});
  }
  if (!supabaseRef || (!storedConnString && !anonKey && !managementPat)) {
    throw new Error(
      "Kelp couldn't find your app's backend in the connected repository. The " +
        "active pen test works with apps built on Supabase (including Lovable " +
        "Cloud, Bolt and v0) — Kelp reads the backend automatically from the " +
        "repo. If your app uses a different backend, it isn't supported yet.",
    );
  }

  // The autonomous multi-agent squad IS the pen test now. Each agent reasons +
  // attacks + loops over its surface, using repo-derived schema when there's no
  // live DB connection.
  const { entries, toolbox, makeDriver, authModel } = await buildAutonomousCampaign({
    supabaseRef,
    readonlyConnString: storedConnString,
    repoSchema,
    supabaseAnonKey: anonKey,
    supabaseManagementPat: managementPat,
    supabaseServiceRoleKey: serviceRoleKey,
    onDiscoveredAnonKey: async (k) => {
      await putCredential(scan.orgId, scan.projectId, "supabase_anon_key", k);
    },
    onDiscoveredServiceRoleKey: async (k) => {
      await putCredential(scan.orgId, scan.projectId, "supabase_service_role", k);
    },
    accountA,
    accountB,
    edgeFunctions,
    sourceFiles,
  });

  const ctx: SpecialistContext = {
    orgId: scan.orgId,
    projectId: scan.projectId,
    jobId: scan.scanId,
  };

  // Autonomous agents run until THEY decide they're done (call conclude), not
  // until we cut them off. Budget is a safety net for runaway loops, not the
  // stopping criterion. Set generously — cost is not the constraint; precision
  // and completeness are. Empirical model ceiling for a single Opus tool-use
  // conversation is ~60 steps before the model starts revisiting already-
  // covered ground. Beyond that, split agents by sub-surface rather than
  // stretching one further.
  //
  // Prior incident (usatopoint 06dc909c, 2026-07-09): a follow-up agent
  // narrated a full impact chain at step 10/10 and wrote "Now let me report
  // this finding:" but the loop cut it off before the tool call — the
  // is_staff_or_admin RPC anon-enumeration finding was lost. Persona now
  // instructs "file in the same turn as the reasoning"; budgets doubled so
  // this failure mode never resurfaces on a real vuln.
  const primaryReport = await runActivePentest(
    { consent: consentStoreFromDb(), audit: { record: writeAudit } },
    ctx,
    { entries, maxParallel: 3, maxStepsPer: 60 },
    { acceptedVersions: CONSENT_ACCEPTED_FOR_MULTI_SPECIALIST },
  );

  // Post-hoc reviewer: reads the squad's transcripts, spots unconfirmed leads,
  // and spawns 0..3 focused follow-up agents to convert them into confirmed
  // findings. Cheap when nothing to chase (one review call); crash-isolated so
  // a bad review just falls back to the primary report. Follow-ups go through
  // the same evidence gate — no fabrication path is opened.
  const reviewed = await runReviewerAndFollowups(primaryReport, toolbox, makeDriver, ctx, authModel);

  // Triage (#29 + auth-model): read every confirmed finding with skeptical
  // eyes and downgrade / reclassify / reject before we persist. Cannot
  // upgrade severity, cannot invent findings, cannot re-verify — it only
  // judges the label vs the evidence + the auth-model facts. Crash-isolated.
  const report = await runTriagePass(reviewed, makeDriver, authModel);

  const detected = campaignFindingsToDetected(report.outcomes);
  const found = await upsertFindings(scan.orgId, scan.projectId, scan.scanId, detected);

  const erroredSpecialists = report.outcomes.filter((o) => o.error !== null);
  // NOTE: we do NOT call resolveMissingFindings on the active-pentest path.
  // Autonomous agents make non-deterministic choices between runs (an LLM
  // may or may not re-file the same finding depending on which lead it
  // chased first), so "not seen in this run" is NOT reliable evidence a vuln
  // is fixed. Auto-resolve stays on the deterministic passive path only.
  // The user resolves findings explicitly via the Mark resolved / False
  // positive buttons.

  const costCents = costUsdToCents(report.totalUsage.estimatedCostUsd);
  const errorNote =
    erroredSpecialists.length > 0
      ? JSON.stringify(erroredSpecialists.map((o) => ({ name: o.name, error: o.error })))
      : undefined;
  await finishScan(scan.scanId, "succeeded", errorNote, costCents);

  // Persist the full CampaignReport (per-agent transcript + counts + cost +
  // findings) so the "How the pen test ran" panel can show exactly what the
  // agents did. Bodies were already redacted by the toolbox — safe to store.
  await getPool()
    .query(`update scans set agent_report = $2 where id = $1`, [
      scan.scanId,
      JSON.stringify(campaignReportToPersisted(report)),
    ])
    .catch((e) => console.warn("agent_report persist failed:", e instanceof Error ? e.message : e));

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

/**
 * Trim + shape the CampaignReport for persistence. Keeps the human-useful
 * fields (per-agent name, class, steps, cost, findings, error, transcript)
 * and caps the transcript text so a very chatty agent can't blow up the row.
 * Response bodies were already redacted by the toolbox — transcripts hold
 * only the agent's narration + tool-choice reasoning, no user data.
 */
function campaignReportToPersisted(report: {
  outcomes: Array<{
    name: string;
    vulnClass: string;
    findings: unknown[];
    transcript: string[];
    error: string | null;
    steps: number;
    usage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number } | null;
  }>;
  totalUsage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number };
}): unknown {
  const MAX_STEP_CHARS = 1200;
  const MAX_STEPS = 60;
  return {
    version: 1,
    totalUsage: report.totalUsage,
    outcomes: report.outcomes.map((o) => ({
      name: o.name,
      vulnClass: o.vulnClass,
      steps: o.steps,
      findingsCount: o.findings.length,
      error: o.error,
      usage: o.usage,
      transcript: o.transcript
        .slice(0, MAX_STEPS)
        .map((t) => (t.length > MAX_STEP_CHARS ? t.slice(0, MAX_STEP_CHARS) + "…" : t)),
    })),
  };
}

/**
 * Post-hoc reviewer + follow-ups. Runs after the primary squad:
 *   1. Reviewer LLM reads the outcomes, queues up to 3 leads.
 *   2. Each lead is chased by a focused follow-up specialist (8 steps max).
 *   3. Follow-up outcomes + their findings are merged into the report.
 *
 * Never throws — a reviewer or follow-up failure just returns the primary
 * report unchanged. Cost is bounded by the lead cap: one review call plus at
 * most 3 short follow-ups. Same evidence gate applies to follow-up findings.
 */
async function runReviewerAndFollowups(
  primary: CampaignReport,
  toolbox: PentestTools,
  makeDriver: () => import("@kelp/core").LlmAgentDriver,
  ctx: SpecialistContext,
  authModel: import("@kelp/core").AuthModelBrief,
): Promise<CampaignReport> {
  let leads: Lead[] = [];
  try {
    leads = await reviewCampaign(makeDriver(), primary.outcomes);
  } catch (e) {
    console.warn("reviewer failed:", e instanceof Error ? e.message : e);
    return primary;
  }
  if (leads.length === 0) return primary;

  const followupOutcomes: SpecialistOutcome[] = [];
  for (const lead of leads) {
    try {
      const outcome = await runFollowup(lead, toolbox, makeDriver(), ctx, undefined, { authModel });
      followupOutcomes.push(outcome);
    } catch (e) {
      console.warn(`follow-up ${lead.id} failed:`, e instanceof Error ? e.message : e);
    }
  }
  if (followupOutcomes.length === 0) return primary;

  const merged: CampaignReport = {
    outcomes: [...primary.outcomes, ...followupOutcomes],
    findings: [
      ...primary.findings,
      ...followupOutcomes.flatMap((o) => o.findings),
    ],
    totalUsage: {
      inputTokens:
        primary.totalUsage.inputTokens +
        followupOutcomes.reduce((n, o) => n + (o.usage?.inputTokens ?? 0), 0),
      outputTokens:
        primary.totalUsage.outputTokens +
        followupOutcomes.reduce((n, o) => n + (o.usage?.outputTokens ?? 0), 0),
      estimatedCostUsd:
        primary.totalUsage.estimatedCostUsd +
        followupOutcomes.reduce((n, o) => n + (o.usage?.estimatedCostUsd ?? 0), 0),
    },
  };
  console.log(
    `reviewer queued ${leads.length} lead(s); follow-ups produced ${
      followupOutcomes.reduce((n, o) => n + o.findings.length, 0)
    } finding(s).`,
  );
  return merged;
}

/**
 * Post-review triage pass (#29). One LLM call reads the confirmed findings
 * and can downgrade / reclassify / reject each one before it ships. Adds the
 * triage cost onto the campaign's totalUsage so the shown cost stays honest.
 * Never throws — a triage failure just returns the reviewed report unchanged.
 */
async function runTriagePass(
  reviewed: CampaignReport,
  makeDriver: () => import("@kelp/core").LlmAgentDriver,
  authModel: import("@kelp/core").AuthModelBrief,
): Promise<CampaignReport> {
  if (reviewed.findings.length === 0) return reviewed;
  let triageResult: Awaited<ReturnType<typeof triageCampaign>>;
  try {
    triageResult = await triageCampaign(makeDriver(), reviewed.outcomes, authModel);
  } catch (e) {
    console.warn("triage failed:", e instanceof Error ? e.message : e);
    return reviewed;
  }
  if (triageResult.decisions.length === 0) return reviewed;

  const applied = applyTriage(reviewed, triageResult.decisions);
  const merged: CampaignReport = {
    outcomes: applied.outcomes,
    findings: applied.findings,
    totalUsage: {
      inputTokens:
        reviewed.totalUsage.inputTokens + (triageResult.usage?.inputTokens ?? 0),
      outputTokens:
        reviewed.totalUsage.outputTokens + (triageResult.usage?.outputTokens ?? 0),
      estimatedCostUsd:
        reviewed.totalUsage.estimatedCostUsd +
        (triageResult.usage?.estimatedCostUsd ?? 0),
    },
  };
  console.log(summarizeTriage(triageResult.decisions));
  return merged;
}

/** Drain all currently-queued scans (local dev / poll loop tick). */
export async function drainScans(): Promise<void> {
  for (;;) {
    const r = await processOneScan();
    if (!r.processed) break;
    console.log(`  scan ${r.scanId}: ${r.found} finding(s), ${r.errors} error(s)`);
  }
}
