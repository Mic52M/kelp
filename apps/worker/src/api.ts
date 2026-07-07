// Web-facing engine API. The Next.js server actions import these from
// @kelp/worker so the connect flow reuses the real scan engine (no duplication).

import { createHmac, timingSafeEqual } from "node:crypto";
import type { VulnClass } from "@kelp/core";
import { getPool, putCredential, listOrgInstallationIds, saveGithubInstallation } from "./db.js";
import { createGitHubApp, createGitHubConnector } from "./connectors/github.js";
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
 * Dev fallback: if the org has registered no installations yet but a single
 * GITHUB_APP_INSTALLATION_ID is set in env, use it. This keeps local dev working
 * before the install flow is wired end-to-end; production orgs always have their
 * own rows (see saveGithubInstallation).
 */
export async function listReposForOrg(orgId: string): Promise<RepoOption[]> {
  let installationIds = await listOrgInstallationIds(orgId);
  if (installationIds.length === 0) {
    const envId = process.env.GITHUB_APP_INSTALLATION_ID;
    if (envId) installationIds = [Number(envId)];
  }

  const app = githubAppEnv();
  const out: RepoOption[] = [];
  const seen = new Set<string>();
  for (const installationId of installationIds) {
    const repos = await createGitHubConnector({ ...app, installationId }).listRepos();
    for (const fullName of repos) {
      if (seen.has(fullName)) continue; // a repo could be visible via two installs
      seen.add(fullName);
      out.push({ fullName, installationId });
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

/** Enqueue a scan for a project. The worker poll loop picks it up. */
export async function enqueueScanForProject(input: {
  orgId: string;
  projectId: string;
  classes: VulnClass[];
  trigger?: "initial" | "manual" | "webhook_push";
}): Promise<{ scanId: string }> {
  const { rows } = await getPool().query(
    `insert into scans (org_id, project_id, status, trigger, classes)
     values ($1, $2, 'queued', $3, $4::vuln_class[]) returning id`,
    [input.orgId, input.projectId, input.trigger ?? "manual", input.classes],
  );
  const scanId = rows[0].id as string;
  // If Redis is configured, hand the job to the durable queue (#7); otherwise
  // the DB poll loop / Next after() path picks the 'queued' row up (local dev).
  await enqueueScanJob(scanId);
  return { scanId };
}

/** Create the project (+ encrypted creds) and enqueue its first scan. */
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
