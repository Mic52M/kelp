// Web-facing engine API. The Next.js server actions import these from
// @kelp/worker so the connect flow reuses the real scan engine (no duplication).

import { createHmac, timingSafeEqual } from "node:crypto";
import type { BackendReport, VulnClass } from "@kelp/core";
import {
  analyzeBackend,
  assertCanCreateProject,
  assertCanTriggerRescan,
  detectSupabaseConfig,
} from "@kelp/core";
import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicDriver } from "./agent/anthropic-driver.js";
import {
  countProjectsForOrg,
  getCredential,
  getPool,
  listOrgInstallationIds,
  loadOrgPlan,
  putCredential,
  revokeGithubInstallation,
  saveGithubInstallation,
} from "./db.js";
import { createGitHubApp, createGitHubConnector } from "./connectors/github.js";
import { connectAsReadonly, KELP_READONLY_ROLE } from "./connectors/supabase-pg.js";
import { enqueueScanJob } from "./redis-queue.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

function githubAppEnv() {
  return {
    appId: requireEnv("GITHUB_APP_ID"),
    privateKey: Buffer.from(requireEnv("GITHUB_APP_PRIVATE_KEY_BASE64"), "base64").toString("utf8"),
  };
}

export interface RepoOption {
  fullName: string;
  /** the installation this repo is reachable through */
  installationId: number;
}

/**
 * Repositories reachable for an org, aggregated across all its GitHub App
 * installations. Each repo carries the installation it came from, so the
 * connect step stores the right installation on the project.
 *
 * Returns an empty list when the org has no installations registered — the
 * UI reads that as "prompt the install flow" instead of a runtime error.
 * Installations from foreign accounts silently 404 on token exchange rather
 * than surfacing a confusing "Not Found" to the user (this happened when a
 * stale `GITHUB_APP_INSTALLATION_ID` env fallback pointed at an install that
 * no longer belonged to this App after a rename/transfer).
 */
export async function listReposForOrg(orgId: string): Promise<RepoOption[]> {
  const installationIds = await listOrgInstallationIds(orgId);

  const app = githubAppEnv();
  const out: RepoOption[] = [];
  const seen = new Set<string>();
  for (const installationId of installationIds) {
    try {
      const repos = await createGitHubConnector({ ...app, installationId }).listRepos();
      for (const fullName of repos) {
        if (seen.has(fullName)) continue; // a repo could be visible via two installs
        seen.add(fullName);
        out.push({ fullName, installationId });
      }
    } catch (e) {
      // Installation was uninstalled or moved between accounts — GitHub 404s
      // on the create-installation-access-token endpoint. Revoke the row so
      // hasInstallation reflects reality and the UI shows the install CTA.
      const msg = e instanceof Error ? e.message : String(e);
      if (/Not Found/i.test(msg)) {
        await revokeGithubInstallation(installationId).catch(() => {});
      }
      console.warn(
        `listReposForOrg: installation ${installationId} unreachable, skipping (${msg})`,
      );
    }
  }
  return out;
}

// ─── GitHub App install flow (issue #14) ──────────────────────────────────────
// We send the user to GitHub to install the app, then GitHub redirects back to
// our setup URL. A signed, short-lived `state` ties that redirect to the org
// that started it — so we can attribute the returned installation_id correctly
// without server-side session storage.

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function stateSecret(): string {
  // Reuse the credential key as the HMAC key — it's a server-only 32-byte secret.
  return requireEnv("KELP_CREDENTIAL_ENC_KEY");
}

function signInstallState(orgId: string): string {
  const payload = `${orgId}.${Date.now() + STATE_TTL_MS}`;
  const sig = createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

/** Verify a returned install state; returns the org id or null if invalid/expired. */
export function verifyInstallState(state: string): string | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const payload = Buffer.from(body, "base64url").toString("utf8");
  const expected = createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [orgId, expiryStr] = payload.split(".");
  if (!orgId || !expiryStr) return null;
  if (Date.now() > Number(expiryStr)) return null;
  return orgId;
}

/** URL to send the user to, to install the Kelp GitHub App (with signed state). */
export async function getGithubInstallUrl(orgId: string): Promise<string> {
  const slug = await createGitHubApp(githubAppEnv()).getAppSlug();
  const state = signInstallState(orgId);
  return `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}`;
}

/** Attribute a returned installation to an org (called from the setup callback). */
export async function registerGithubInstallation(input: {
  orgId: string;
  installationId: number;
  connectedBy: string | null;
}): Promise<void> {
  const { login, type } = await createGitHubApp(githubAppEnv()).getInstallationAccount(
    input.installationId,
  );
  await saveGithubInstallation({
    orgId: input.orgId,
    installationId: input.installationId,
    accountLogin: login,
    accountType: type,
    connectedBy: input.connectedBy,
  });
}

export interface SupabaseProjectInfo {
  ref: string;
  name: string;
  region: string;
  status: string;
}

/**
 * Validate a Supabase Postgres connection string (issue #5, revised per item #1).
 * The customer pastes the standard Session-pooler URL as-is — we connect and
 * SET ROLE kelp_readonly. Returns the role we ended up as; on any failure,
 * throws with a user-facing message the UI can surface unchanged.
 */
export async function validateSupabaseReadonlyConnString(connectionString: string): Promise<{ role: string }> {
  let client: Awaited<ReturnType<typeof connectAsReadonly>> | null = null;
  try {
    client = await connectAsReadonly(connectionString);
    const { rows } = await client.query("select current_user as role");
    return { role: (rows[0]?.role as string) ?? KELP_READONLY_ROLE };
  } catch (e) {
    // connectAsReadonly already wraps SET ROLE failures with a helpful message.
    // Anything else here (bad host, wrong password, network) gets the generic
    // "Supabase rejected …" wrapper so callers can display it verbatim.
    const raw = e instanceof Error ? e.message : String(e);
    if (raw.startsWith("Kelp connected but couldn't switch")) throw e;
    throw new Error(`Supabase rejected that connection string: ${raw.slice(0, 200)}`);
  } finally {
    if (client) await client.end().catch(() => {});
  }
}

/**
 * Read the connected repo and auto-detect the Supabase backend (URL/ref +
 * PUBLIC anon key), persisting what it finds: the project's supabase_project_ref
 * and the anon key credential. This is what lets a Lovable-Cloud project be
 * fully configured from the repo alone — the user never pastes the anon key.
 * Best-effort: any failure just leaves the fields for manual entry. Never
 * overwrites an anon key the user set explicitly.
 */
export async function detectAndStoreSupabaseBackend(input: {
  orgId: string;
  projectId: string;
  repoFullName: string;
  installationId: number;
}): Promise<{ ref: string | null; anonKeyDetected: boolean }> {
  const github = createGitHubConnector({
    appId: requireEnv("GITHUB_APP_ID"),
    privateKey: Buffer.from(requireEnv("GITHUB_APP_PRIVATE_KEY_BASE64"), "base64").toString("utf8"),
    installationId: input.installationId,
  });
  const files = await github.listSourceFiles(input.repoFullName);
  const cfg = detectSupabaseConfig(files);
  if (!cfg) return { ref: null, anonKeyDetected: false };

  if (cfg.ref) {
    await getPool().query(
      `update projects set supabase_project_ref = coalesce(supabase_project_ref, $2),
              db_provider = coalesce(db_provider, 'supabase')
        where id = $1`,
      [input.projectId, cfg.ref],
    );
  }
  let anonKeyDetected = false;
  if (cfg.anonKey) {
    const existing = await getCredential(input.projectId, "supabase_anon_key");
    if (!existing) {
      await putCredential(input.orgId, input.projectId, "supabase_anon_key", cfg.anonKey);
    }
    anonKeyDetected = true;
  }
  return { ref: cfg.ref, anonKeyDetected };
}

/**
 * Run the hybrid backend analyzer on the connected repo and persist the
 * resulting BackendReport onto the project row. Called at connect time and
 * on-demand from Configuration when a project has no report yet.
 *
 * Never throws — a failed LLM call falls back to the deterministic-only
 * brief (see analyzeBackend). The customer's Configuration UX degrades
 * gracefully in every failure mode.
 */
export async function analyzeAndStoreBackendReport(input: {
  orgId: string;
  projectId: string;
  repoFullName: string;
  installationId: number;
}): Promise<BackendReport> {
  const github = createGitHubConnector({
    appId: requireEnv("GITHUB_APP_ID"),
    privateKey: Buffer.from(requireEnv("GITHUB_APP_PRIVATE_KEY_BASE64"), "base64").toString("utf8"),
    installationId: input.installationId,
  });
  const files = await github.listSourceFiles(input.repoFullName);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const driver = apiKey
    ? createAnthropicDriver(new Anthropic({ apiKey }), process.env.ANTHROPIC_MODEL_CHEAP ?? "claude-haiku-4-5")
    : undefined;
  const report = await analyzeBackend(files, driver ? { driver } : {});

  await getPool().query(
    `update projects set backend_report = $2 where id = $1`,
    [input.projectId, JSON.stringify(report)],
  );

  // Also seed the legacy fields when we have high-confidence Supabase data
  // so the rest of the pipeline (scan-processor) picks them up immediately.
  if (report.primary.type === "supabase") {
    if (report.publicConfig.supabaseRef) {
      await getPool().query(
        `update projects set supabase_project_ref = coalesce(supabase_project_ref, $2),
                db_provider = coalesce(db_provider, 'supabase')
          where id = $1`,
        [input.projectId, report.publicConfig.supabaseRef],
      );
    }
    if (report.publicConfig.supabaseAnonKey) {
      const existing = await getCredential(input.projectId, "supabase_anon_key");
      if (!existing) {
        await putCredential(
          input.orgId,
          input.projectId,
          "supabase_anon_key",
          report.publicConfig.supabaseAnonKey,
        );
      }
    }
  }

  return report;
}

/** Fetch the persisted BackendReport for a project (or null if not analyzed yet). */
export async function loadBackendReport(projectId: string): Promise<BackendReport | null> {
  const { rows } = await getPool().query(
    `select backend_report from projects where id = $1`,
    [projectId],
  );
  const r = rows[0]?.backend_report;
  return r ? (r as BackendReport) : null;
}

export interface ProjectConfigStatus {
  projectId: string;
  hasSupabaseManagement: boolean;
  hasSupabaseReadonly: boolean;
  /** Whether an explicit anon key is stored. The scan can also auto-fetch
   *  via the Management PAT when this is false — see resolveAnonKey. */
  hasSupabaseAnonKey: boolean;
  appBaseUrl: string | null;
  /** Email of the stored test account A (never the password). Null if unset. */
  testAccountAEmail: string | null;
  testAccountBEmail: string | null;
}

/**
 * Load per-project configuration status for Settings/Configuration UI.
 * Booleans for credentials we never re-render (tokens, passwords); plaintext
 * for values the user pasted themselves and expects to see (app URL, test
 * account emails). Passwords for A/B are deliberately never returned.
 */
export async function getProjectConfigStatus(projectId: string): Promise<ProjectConfigStatus> {
  const [mgmt, ro, anon, appRow, credA, credB] = await Promise.all([
    getCredential(projectId, "supabase_management"),
    getCredential(projectId, "supabase_readonly_connstring"),
    getCredential(projectId, "supabase_anon_key"),
    getPool().query<{ app_base_url: string | null }>(
      `select app_base_url from projects where id = $1`,
      [projectId],
    ),
    getCredential(projectId, "app_test_account_a"),
    getCredential(projectId, "app_test_account_b"),
  ]);
  const emailFromJson = (raw: string | null): string | null => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { email?: unknown };
      return typeof parsed.email === "string" ? parsed.email : null;
    } catch {
      return null;
    }
  };
  return {
    projectId,
    hasSupabaseManagement: mgmt !== null,
    hasSupabaseReadonly: ro !== null,
    hasSupabaseAnonKey: anon !== null,
    appBaseUrl: appRow.rows[0]?.app_base_url ?? null,
    testAccountAEmail: emailFromJson(credA),
    testAccountBEmail: emailFromJson(credB),
  };
}

/** Projects reachable with a Supabase Management API token (for the DB picker). */
export async function listSupabaseProjects(token: string): Promise<SupabaseProjectInfo[]> {
  const res = await fetch("https://api.supabase.com/v1/projects", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      res.status === 401
        ? "That Supabase token was rejected. Check you pasted a valid Management API token."
        : `Supabase API ${res.status}: ${body.slice(0, 160)}`,
    );
  }
  const data = (await res.json()) as Array<{ id: string; name: string; region: string; status: string }>;
  return data.map((p) => ({ ref: p.id, name: p.name, region: p.region, status: p.status }));
}

export interface ConnectInput {
  orgId: string;
  name: string;
  repoFullName: string | null;
  /** installation the repo is reachable through (from the repo picker) */
  installationId: number | null;
  supabaseRef: string | null;
  supabaseToken: string | null;
  classes: VulnClass[];
}

/**
 * Enqueue a scan for a project. Refuses when the org's plan doesn't allow the
 * given trigger (issue #17) — e.g. a free-tier org can't be re-scanned by a
 * `webhook_push`. `initial` is never gated: the first-scan aha-moment must
 * always work.
 *
 * The worker poll loop picks the scan up, or (if REDIS_URL is set) BullMQ does.
 */
export async function enqueueScanForProject(input: {
  orgId: string;
  projectId: string;
  classes: VulnClass[];
  trigger?: "initial" | "manual" | "webhook_push" | "pr_check";
  /** 'passive' (default) or 'active_pentest' (#27) — multi-agent campaign. */
  mode?: "passive" | "active_pentest";
  /** For #36 (kelp/check GitHub Action): pin scan to a specific commit SHA. */
  headSha?: string | null;
  /** For #36: base SHA to diff against — findings NEW since base gate the PR. */
  baseSha?: string | null;
  /** For #36: the PR number to comment on after the scan finishes. */
  prNumber?: number | null;
}): Promise<{ scanId: string }> {
  const trigger = input.trigger ?? "manual";
  const mode = input.mode ?? "passive";
  // The very first scan of a project is `initial` — always allowed. Everything
  // else is checked against the org's plan. Active pen-testing has its own gate
  // (assertActivePentestAvailable) enforced here so the web action doesn't need
  // to duplicate the plan lookup.
  if (trigger !== "initial") {
    const plan = await loadOrgPlan(input.orgId);
    assertCanTriggerRescan(plan, trigger);
    if (mode === "active_pentest") {
      const { assertActivePentestAvailable } = await import("@kelp/core");
      assertActivePentestAvailable(plan);
    }
  }
  const { rows } = await getPool().query(
    `insert into scans (org_id, project_id, status, trigger, classes, mode, head_sha, base_sha, pr_number)
     values ($1, $2, 'queued', $3, $4::vuln_class[], $5, $6, $7, $8) returning id`,
    [
      input.orgId,
      input.projectId,
      trigger,
      input.classes,
      mode,
      input.headSha ?? null,
      input.baseSha ?? null,
      input.prNumber ?? null,
    ],
  );
  const scanId = rows[0].id as string;
  // If Redis is configured, hand the job to the durable queue (#7); otherwise
  // the DB poll loop / Next after() path picks the 'queued' row up (local dev).
  await enqueueScanJob(scanId);
  return { scanId };
}

/**
 * Create the project (+ encrypted creds) and enqueue its first scan.
 * Refuses if the org has reached its plan's project cap (issue #17), but
 * *never* refuses on an already-existing project (the connect flow is
 * idempotent — clicking "Connect" again on a repo you already have is fine).
 */
export async function createProjectAndEnqueueScan(
  input: ConnectInput,
): Promise<{ projectId: string; scanId: string }> {
  // The repo's installation comes from the picker; only meaningful with a repo.
  const installationId = input.repoFullName ? input.installationId : null;
  if (input.repoFullName && installationId == null) {
    throw new Error("missing GitHub installation for the selected repository");
  }

  // Idempotent connect: if this repo is already a project for the org, reuse it
  // (and update its Supabase link if one was provided) instead of erroring.
  let projectId: string | null = null;
  if (input.repoFullName) {
    const existing = await getPool().query(
      `select id from projects where org_id = $1 and github_repo_full_name = $2`,
      [input.orgId, input.repoFullName],
    );
    if (existing.rows.length > 0) {
      projectId = existing.rows[0].id as string;
      if (input.supabaseRef) {
        await getPool().query(
          `update projects set supabase_project_ref = $2, db_provider = 'supabase' where id = $1`,
          [projectId, input.supabaseRef],
        );
      }
    }
  }

  if (!projectId) {
    // Plan gate (issue #17): we're about to insert a new project, so the org
    // must be under its cap. Idempotent re-connects don't hit this — projectId
    // is already non-null in that branch.
    const [plan, current] = await Promise.all([
      loadOrgPlan(input.orgId),
      countProjectsForOrg(input.orgId),
    ]);
    assertCanCreateProject(plan, current);

    const { rows } = await getPool().query(
      `insert into projects
         (org_id, name, github_repo_full_name, github_installation_id, db_provider, supabase_project_ref)
       values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [
        input.orgId,
        input.name,
        input.repoFullName,
        installationId,
        input.supabaseRef ? "supabase" : null,
        input.supabaseRef,
      ],
    );
    projectId = rows[0].id as string;
  }

  if (input.supabaseRef && input.supabaseToken) {
    await putCredential(input.orgId, projectId, "supabase_management", input.supabaseToken);
  }

  const { scanId } = await enqueueScanForProject({
    orgId: input.orgId,
    projectId,
    classes: input.classes,
    trigger: "initial",
  });
  return { projectId, scanId };
}
