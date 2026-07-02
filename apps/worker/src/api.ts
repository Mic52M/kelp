// Web-facing engine API. The Next.js server actions import these from
// @kelp/worker so the connect flow reuses the real scan engine (no duplication).

import type { VulnClass } from "@kelp/core";
import { getPool, putCredential } from "./db.js";
import { createGitHubConnector } from "./connectors/github.js";
import { runScanForProject, type ScanOutcome } from "./scan-processor.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

function githubEnv() {
  return {
    appId: requireEnv("GITHUB_APP_ID"),
    privateKey: Buffer.from(requireEnv("GITHUB_APP_PRIVATE_KEY_BASE64"), "base64").toString("utf8"),
    installationId: Number(requireEnv("GITHUB_APP_INSTALLATION_ID")),
  };
}

/** Repositories the GitHub App installation can access (for the repo picker). */
export async function listInstallationRepos(): Promise<string[]> {
  return createGitHubConnector(githubEnv()).listRepos();
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
  supabaseRef: string | null;
  supabaseToken: string | null;
  classes: VulnClass[];
}

/** Create the project (+ encrypted creds) and run the first scan inline. */
export async function createProjectAndScan(
  input: ConnectInput,
): Promise<{ projectId: string } & ScanOutcome> {
  const installationId = input.repoFullName ? githubEnv().installationId : null;

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

  const outcome = await runScanForProject({
    orgId: input.orgId,
    projectId,
    classes: input.classes,
    trigger: "initial",
  });
  return { projectId, ...outcome };
}
