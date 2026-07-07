// Worker database access. The worker connects with a privileged role (DATABASE_URL)
// that bypasses RLS — it operates across tenants by design. Credentials are
// decrypted here with the app encryption key; plaintext never leaves the worker.

import pg from "pg";
import {
  openSecret,
  sealSecret,
  type DetectedFinding,
  type PlanTier,
  type ScanMode,
  type VulnClass,
} from "@kelp/core";

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
  /** 'passive' → deterministic scanners; 'active_pentest' → multi-agent campaign (#27). */
  mode: ScanMode;
}

/** Atomically claim the next queued scan (skip-locked), marking it running. */
export async function claimQueuedScan(): Promise<ClaimedScan | null> {
  const { rows } = await getPool().query(
    `update scans set status = 'running', started_at = now()
     where id = (
       select id from scans where status = 'queued'
       order by queued_at limit 1 for update skip locked
     )
     returning id, org_id, project_id, classes::text[], mode`,
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    scanId: r.id,
    orgId: r.org_id,
    projectId: r.project_id,
    classes: r.classes,
    mode: r.mode as ScanMode,
  };
}

/** Claim one specific queued scan by id (for Redis/BullMQ delivery, issue #7).
 *  Returns null if the row isn't 'queued' anymore — i.e. already claimed by
 *  another consumer / poller — so a duplicate or replayed job is a safe no-op. */
export async function claimScanById(scanId: string): Promise<ClaimedScan | null> {
  const { rows } = await getPool().query(
    `update scans set status = 'running', started_at = now()
     where id = $1 and status = 'queued'
     returning id, org_id, project_id, classes::text[], mode`,
    [scanId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    scanId: r.id,
    orgId: r.org_id,
    projectId: r.project_id,
    classes: r.classes,
    mode: r.mode as ScanMode,
  };
}

/** Ids of scans still 'queued' (oldest first) — used by the Redis reconciler
 *  to re-deliver rows that never reached Redis (e.g. enqueued while Redis was
 *  down). Idempotent because delivery uses jobId=scanId. */
export async function listQueuedScanIds(limit = 50): Promise<string[]> {
  const { rows } = await getPool().query(
    `select id from scans where status = 'queued' order by queued_at limit $1`,
    [limit],
  );
  return rows.map((r) => r.id as string);
}

export interface ProjectRow {
  id: string;
  orgId: string;
  repoFullName: string | null;
  installationId: number | null;
  supabaseRef: string | null;
  appBaseUrl: string | null;
}

export async function loadProject(projectId: string): Promise<ProjectRow | null> {
  const { rows } = await getPool().query(
    `select id, org_id, github_repo_full_name, github_installation_id,
            supabase_project_ref, app_base_url
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
    appBaseUrl: r.app_base_url,
  };
}

/** Store the customer's deployed app URL for active_pentest scans (#27). */
export async function setAppBaseUrl(projectId: string, url: string | null): Promise<void> {
  await getPool().query(`update projects set app_base_url = $2 where id = $1`, [projectId, url]);
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

/** Locate a project by GitHub identity — used by the push webhook. */
export async function findProjectByRepo(
  repoFullName: string,
  installationId: number,
): Promise<{ id: string; orgId: string } | null> {
  const { rows } = await getPool().query(
    `select id, org_id from projects
     where github_repo_full_name = $1 and github_installation_id = $2
     limit 1`,
    [repoFullName, installationId],
  );
  if (rows.length === 0) return null;
  return { id: rows[0].id as string, orgId: rows[0].org_id as string };
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

/**
 * Close findings the current scan should have re-detected but didn't. Scope is
 * (project_id × vuln_class × currently-open states) — scanning only the repo
 * must not resolve RLS findings, and a class that errored this run must not
 * resolve its findings either (the caller filters `classes` to successful ones).
 * `needs_review`, `confirmed` and `dismissed` are left alone: BOLA needs a human,
 * and dismissed is the user's explicit choice.
 */
export async function resolveMissingFindings(
  projectId: string,
  currentScanId: string,
  classes: VulnClass[],
): Promise<number> {
  if (classes.length === 0) return 0;
  const { rowCount } = await getPool().query(
    `update findings
       set status = 'resolved',
           resolved_at = now(),
           updated_at = now()
     where project_id = $1
       and vuln_class = any($2::vuln_class[])
       and last_scan_id <> $3
       and status in ('open', 'pr_opened', 'regressed')`,
    [projectId, classes, currentScanId],
  );
  return rowCount ?? 0;
}

export async function finishScan(
  scanId: string,
  status: "succeeded" | "failed",
  error?: string,
  /**
   * Claude spend attributable to this scan, in USD cents (issue #25). Null for
   * deterministic scans that never call an LLM; populated for active-pentest
   * scans from the campaign's totalUsage.
   */
  costCents?: number | null,
): Promise<void> {
  await getPool().query(
    `update scans set status = $2, finished_at = now(), error = $3, cost_cents = $4 where id = $1`,
    [scanId, status, error ?? null, costCents ?? null],
  );
}

/**
 * Month-to-date campaign Claude spend for an org, in USD cents (issue #25).
 * Used by the cap check before dispatching a new active-pentest campaign.
 * NULL cost_cents rows (deterministic scans) are excluded — they don't spend.
 */
export async function monthToDateCampaignCostCents(orgId: string): Promise<number> {
  const { rows } = await getPool().query(
    `select coalesce(sum(cost_cents), 0)::int as total
       from scans
      where org_id = $1
        and cost_cents is not null
        and started_at >= date_trunc('month', now())`,
    [orgId],
  );
  return rows[0]?.total ?? 0;
}

// ─── Plan lookup + project count (issue #17) ─────────────────────────────────

/** Read the org's current plan tier (feeds every plan-gate check). */
export async function loadOrgPlan(orgId: string): Promise<PlanTier> {
  const { rows } = await getPool().query(
    `select plan from orgs where id = $1`,
    [orgId],
  );
  if (rows.length === 0) throw new Error(`org ${orgId} not found`);
  return rows[0].plan as PlanTier;
}

/** How many projects the org has connected right now (for the max-projects gate). */
export async function countProjectsForOrg(orgId: string): Promise<number> {
  const { rows } = await getPool().query(
    `select count(*)::int as n from projects where org_id = $1`,
    [orgId],
  );
  return rows[0]?.n ?? 0;
}

// ─── Active-test consent (issue #24) ─────────────────────────────────────────
// The consent row is the load-bearing legal artifact: multi-specialist campaigns
// need a non-revoked v2, BOLA-only campaigns accept v1 or v2. These helpers own
// the writes so scattered callers can't corrupt the shape (e.g. forget to store
// the verbatim text alongside the version).

export interface StoredActiveTestConsent {
  id: string;
  projectId: string;
  orgId: string;
  consented: boolean;
  consentVersion: string;
  consentedAt: Date;
  revokedAt: Date | null;
  consentedBy: string;
  /** Verbatim text stored when the row was inserted (audit-of-record). */
  consentText: string;
}

/** Current (non-revoked) consent for a project, or null. */
export async function loadActiveTestConsent(
  projectId: string,
): Promise<StoredActiveTestConsent | null> {
  const { rows } = await getPool().query(
    `select id, project_id, org_id, consented, consent_version, consented_at,
            revoked_at, consented_by, consent_text
       from active_test_consents
      where project_id = $1 and revoked_at is null
      limit 1`,
    [projectId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    projectId: r.project_id,
    orgId: r.org_id,
    consented: r.consented,
    consentVersion: r.consent_version,
    consentedAt: new Date(r.consented_at),
    revokedAt: r.revoked_at === null ? null : new Date(r.revoked_at),
    consentedBy: r.consented_by,
    consentText: r.consent_text,
  };
}

/**
 * Resolve a user id to email (used to render the signed-consent record —
 * we display the human email, not the opaque uuid). Returns null when the
 * user has been deleted.
 */
export async function findUserEmail(userId: string): Promise<string | null> {
  const { rows } = await getPool().query(`select email from users where id = $1`, [userId]);
  return rows[0]?.email ?? null;
}

/** Human-readable org name for the signed-consent record. */
export async function findOrgName(orgId: string): Promise<string | null> {
  const { rows } = await getPool().query(`select name from orgs where id = $1`, [orgId]);
  return rows[0]?.name ?? null;
}

/**
 * Insert a fresh consent row (v1 or v2). Revokes any existing non-revoked row
 * for the project first — the schema has a unique index on `project_id` where
 * `revoked_at is null`, so two active rows would fail to insert. Idempotent
 * against double-clicks (the caller sees the newest row after).
 */
export async function saveActiveTestConsent(input: {
  orgId: string;
  projectId: string;
  consentText: string;
  consentVersion: string;
  consentedBy: string;
}): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query(
      `update active_test_consents
          set revoked_at = now(), revoked_by = $2
        where project_id = $1 and revoked_at is null`,
      [input.projectId, input.consentedBy],
    );
    await client.query(
      `insert into active_test_consents
          (org_id, project_id, consented, consent_text, consent_version, consented_by)
       values ($1, $2, true, $3, $4, $5)`,
      [input.orgId, input.projectId, input.consentText, input.consentVersion, input.consentedBy],
    );
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

/** Revoke the current consent for a project. No-op if none is active. */
export async function revokeActiveTestConsent(input: {
  projectId: string;
  revokedBy: string;
}): Promise<void> {
  await getPool().query(
    `update active_test_consents
        set revoked_at = now(), revoked_by = $2
      where project_id = $1 and revoked_at is null`,
    [input.projectId, input.revokedBy],
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
