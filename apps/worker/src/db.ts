// Worker database access. The worker connects with a privileged role (DATABASE_URL)
// that bypasses RLS — it operates across tenants by design. Credentials are
// decrypted here with the app encryption key; plaintext never leaves the worker.

import pg from "pg";
import { openSecret, sealSecret, type DetectedFinding, type VulnClass } from "@kelp/core";

let pool: pg.Pool | null = null;
export function getPool(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

function encKey(): string {
  const k = process.env.KELP_CREDENTIAL_ENC_KEY;
  if (!k) throw new Error("KELP_CREDENTIAL_ENC_KEY is not set");
  return k;
}

export interface ClaimedScan {
  scanId: string;
  orgId: string;
  projectId: string;
  classes: VulnClass[];
}

/** Atomically claim the next queued scan (skip-locked), marking it running. */
export async function claimQueuedScan(): Promise<ClaimedScan | null> {
  const { rows } = await getPool().query(
    `update scans set status = 'running', started_at = now()
     where id = (
       select id from scans where status = 'queued'
       order by queued_at limit 1 for update skip locked
     )
     returning id, org_id, project_id, classes`,
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return { scanId: r.id, orgId: r.org_id, projectId: r.project_id, classes: r.classes };
}

export interface ProjectRow {
  id: string;
  orgId: string;
  repoFullName: string | null;
  installationId: number | null;
  supabaseRef: string | null;
}

export async function loadProject(projectId: string): Promise<ProjectRow | null> {
  const { rows } = await getPool().query(
    `select id, org_id, github_repo_full_name, github_installation_id, supabase_project_ref
     from projects where id = $1`,
    [projectId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    orgId: r.org_id,
    repoFullName: r.github_repo_full_name,
    installationId: r.github_installation_id === null ? null : Number(r.github_installation_id),
    supabaseRef: r.supabase_project_ref,
  };
}

/** Record (or re-activate) a GitHub App installation for an org. Idempotent. */
export async function saveGithubInstallation(input: {
  orgId: string;
  installationId: number;
  accountLogin: string | null;
  accountType: string | null;
  connectedBy: string | null;
}): Promise<void> {
  await getPool().query(
    `insert into github_installations
       (org_id, installation_id, account_login, account_type, connected_by)
     values ($1, $2, $3, $4, $5)
     on conflict (installation_id) do update set
       org_id = excluded.org_id,
       account_login = excluded.account_login,
       account_type = excluded.account_type,
       connected_by = excluded.connected_by,
       revoked_at = null`,
    [input.orgId, input.installationId, input.accountLogin, input.accountType, input.connectedBy],
  );
}

/** Active (non-revoked) installation ids for an org. */
export async function listOrgInstallationIds(orgId: string): Promise<number[]> {
  const { rows } = await getPool().query(
    `select installation_id from github_installations
     where org_id = $1 and revoked_at is null
     order by created_at`,
    [orgId],
  );
  return rows.map((r) => Number(r.installation_id));
}

/** Decrypt a stored credential, or null if the project doesn't have that kind. */
export async function getCredential(projectId: string, kind: string): Promise<string | null> {
  const { rows } = await getPool().query(
    `select ciphertext, nonce from project_credentials where project_id = $1 and token_kind = $2`,
    [projectId, kind],
  );
  if (rows.length === 0) return null;
  return openSecret({ ciphertext: rows[0].ciphertext, nonce: rows[0].nonce }, encKey());
}

/** Encrypt and store a credential (used by the connect flow / seed). */
export async function putCredential(
  orgId: string,
  projectId: string,
  kind: string,
  secret: string,
): Promise<void> {
  const sealed = sealSecret(secret, encKey());
  await getPool().query(
    `insert into project_credentials (org_id, project_id, token_kind, ciphertext, nonce)
     values ($1, $2, $3, $4, $5)
     on conflict (project_id, token_kind) do update
       set ciphertext = excluded.ciphertext, nonce = excluded.nonce, rotated_at = now()`,
    [orgId, projectId, kind, sealed.ciphertext, sealed.nonce],
  );
}

/** Upsert findings by (project_id, fingerprint). Returns how many were written. */
export async function upsertFindings(
  orgId: string,
  projectId: string,
  scanId: string,
  findings: DetectedFinding[],
): Promise<number> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    for (const f of findings) {
      const status = f.vulnClass === "bola" ? "needs_review" : "open";
      await client.query(
        `insert into findings
           (org_id, project_id, first_scan_id, last_scan_id, vuln_class, severity, status,
            fingerprint, title, explanation, location, evidence)
         values ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         on conflict (project_id, fingerprint) do update set
           last_scan_id = excluded.last_scan_id,
           severity = excluded.severity,
           title = excluded.title,
           explanation = excluded.explanation,
           location = excluded.location,
           evidence = excluded.evidence,
           updated_at = now(),
           resolved_at = null,
           status = case when findings.status = 'resolved' then 'regressed' else findings.status end`,
        [
          orgId,
          projectId,
          scanId,
          f.vulnClass,
          f.severity,
          status,
          f.fingerprint,
          f.title,
          f.explanation,
          f.location,
          JSON.stringify({ fixable: f.fixable, raw: f.raw }),
        ],
      );
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
  return findings.length;
}

export async function finishScan(scanId: string, status: "succeeded" | "failed", error?: string): Promise<void> {
  await getPool().query(
    `update scans set status = $2, finished_at = now(), error = $3 where id = $1`,
    [scanId, status, error ?? null],
  );
}

export async function writeAudit(entry: {
  orgId: string;
  projectId: string;
  actorType: string;
  actorId: string;
  action: string;
  resource?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await getPool().query(
    `insert into audit_log (org_id, project_id, actor_type, actor_id, action, resource, metadata)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      entry.orgId,
      entry.projectId,
      entry.actorType,
      entry.actorId,
      entry.action,
      entry.resource ?? null,
      JSON.stringify(entry.metadata ?? {}),
    ],
  );
}
