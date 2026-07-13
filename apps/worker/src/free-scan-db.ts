// Free-scan DB access (worker-side). Kept separate from `db.ts` because the
// paid path treats free_scans as an implementation detail of the funnel, not
// part of the tenant model — it has no org_id, no RLS.

import { randomBytes } from "node:crypto";
import { getPool } from "./db.js";

/** URL-safe 10-char slug, ~60 bits of entropy — un-guessable in practice. */
export function newSlug(): string {
  const alpha = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/1/l/o/i confusion
  const buf = randomBytes(10);
  let out = "";
  for (let i = 0; i < 10; i++) out += alpha[buf[i]! % alpha.length];
  return out;
}

export interface InsertFreeScanInput {
  repoUrl: string;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  ipHash: string;
  userAgent: string | null;
}

export async function insertFreeScan(input: InsertFreeScanInput): Promise<{ id: string; slug: string }> {
  // Retry once if slug happens to collide (astronomically rare with 32^10).
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = newSlug();
    try {
      const { rows } = await getPool().query(
        `insert into free_scans
              (slug, repo_url, supabase_url, supabase_anon_key, ip_hash, user_agent)
         values ($1, $2, $3, $4, $5, $6)
         returning id, slug`,
        [
          slug,
          input.repoUrl,
          input.supabaseUrl,
          input.supabaseAnonKey,
          input.ipHash,
          input.userAgent,
        ],
      );
      return { id: rows[0].id, slug: rows[0].slug };
    } catch (e) {
      // Unique-violation on slug → retry with a fresh one.
      if ((e as { code?: string }).code === "23505" && attempt < 2) continue;
      throw e;
    }
  }
  throw new Error("failed to insert free_scan after retries");
}

/** How many free scans this IP started in the last N minutes. */
export async function countRecentFreeScansForIp(
  ipHash: string,
  windowMinutes: number,
): Promise<number> {
  const { rows } = await getPool().query(
    `select count(*)::int as n
       from free_scans
      where ip_hash = $1 and created_at > now() - ($2 || ' minutes')::interval`,
    [ipHash, String(windowMinutes)],
  );
  return rows[0]?.n ?? 0;
}

/** Most recent scan for a canonicalized repo URL, if any. */
export async function findLatestFreeScanForRepo(repoUrl: string): Promise<{
  id: string;
  slug: string;
  status: string;
  createdAt: Date;
} | null> {
  const { rows } = await getPool().query(
    `select id, slug, status, created_at
       from free_scans
      where repo_url = $1
      order by created_at desc
      limit 1`,
    [repoUrl],
  );
  const r = rows[0];
  if (!r) return null;
  return { id: r.id, slug: r.slug, status: r.status, createdAt: r.created_at };
}

export interface FreeScanPublicView {
  id: string;
  slug: string;
  repoUrl: string;
  status: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  findings: unknown[];
  /** Diagnostic envelope written by the processor (v1 shape). */
  diagnostic: FreeScanDiagnostic | null;
  capturedEmail: string | null;
  error: string | null;
  createdAt: Date;
}

export interface FreeScanDiagnostic {
  version: number;
  ranScanners: string[];
  notes: string[];
  backendDetected: "supabase" | "firebase" | "none";
  filesScanned: number;
  entriesSeen: number;
  capReached: boolean;
  tablesParsed: number;
  counts: { critical: number; high: number; medium: number; low: number };
}

async function selectFreeScan(
  by: "id" | "slug",
  key: string,
): Promise<FreeScanPublicView | null> {
  const { rows } = await getPool().query(
    `select id, slug, repo_url, status, started_at, finished_at, duration_ms,
            findings, agent_report, captured_email, error, created_at
       from free_scans where ${by} = $1`,
    [key],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    slug: r.slug,
    repoUrl: r.repo_url,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    durationMs: r.duration_ms,
    findings: Array.isArray(r.findings) ? r.findings : [],
    diagnostic: (r.agent_report as FreeScanDiagnostic | null) ?? null,
    capturedEmail: r.captured_email,
    error: r.error,
    createdAt: r.created_at,
  };
}

export function getFreeScanById(id: string): Promise<FreeScanPublicView | null> {
  return selectFreeScan("id", id);
}

export function getFreeScanBySlug(slug: string): Promise<FreeScanPublicView | null> {
  return selectFreeScan("slug", slug);
}

/** Store the captured email against the free scan. Idempotent — first write wins. */
export async function captureFreeScanEmail(id: string, email: string): Promise<void> {
  await getPool().query(
    `update free_scans
        set captured_email = coalesce(captured_email, $2),
            captured_email_at = coalesce(captured_email_at, now())
      where id = $1`,
    [id, email.toLowerCase()],
  );
}
