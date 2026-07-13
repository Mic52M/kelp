// Worker-side execution of a queued free scan (#32).
//
// Contract: given a `free_scans.id`, download the public repo tarball, run the
// deterministic scanners via `runFreeScan`, persist findings + status. No LLM,
// no live DB probing, no consent gate needed (no active testing).
//
// Idempotent: if the row is not `queued`, do nothing (duplicate delivery safe).
// Never throws to the caller — all errors are captured on the row.

import { runFreeScan, type FreeScanSummary } from "@kelp/core";
import { getPool } from "./db.js";
import {
  listPublicRepoSourceFiles,
  verifyPublicRepo,
  PublicRepoNotFoundError,
} from "./connectors/github-public.js";

export interface FreeScanRow {
  id: string;
  slug: string;
  repoUrl: string;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
}

/** Parse "https://github.com/owner/repo" → "owner/repo". Trims trailing slash
 *  and any accidental ".git". Throws on anything else. */
export function parseRepoFullName(url: string): string {
  const m = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (!m) throw new PublicRepoNotFoundError(url);
  return `${m[1]}/${m[2]}`;
}

/** Claim a queued row atomically. Returns null if already picked up / gone. */
async function claimFreeScan(id: string): Promise<FreeScanRow | null> {
  const { rows } = await getPool().query(
    `update free_scans
        set status = 'running', started_at = now()
      where id = $1 and status = 'queued'
      returning id, slug, repo_url, supabase_url, supabase_anon_key`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    slug: r.slug,
    repoUrl: r.repo_url,
    supabaseUrl: r.supabase_url,
    supabaseAnonKey: r.supabase_anon_key,
  };
}

async function finishFreeScan(
  id: string,
  input: {
    status: "succeeded" | "failed" | "capped";
    durationMs: number;
    summary?: FreeScanSummary;
    error?: string | null;
  },
): Promise<void> {
  // Persist findings as before, plus a compact "diagnostic" envelope in
  // agent_report (jsonb, already on the table for the v2 autonomous path).
  // Storing it there means we don't need another migration and the reveal
  // API can serve everything with one row read.
  const diag = input.summary
    ? {
        version: 1,
        ranScanners: input.summary.ranScanners,
        notes: input.summary.notes,
        backendDetected: input.summary.backendDetected,
        filesScanned: input.summary.filesScanned,
        entriesSeen: input.summary.entriesSeen,
        capReached: input.summary.capReached,
        tablesParsed: input.summary.tablesParsed,
        counts: input.summary.counts,
      }
    : null;
  await getPool().query(
    `update free_scans
        set status = $2,
            finished_at = now(),
            duration_ms = $3,
            findings = coalesce($4::jsonb, findings),
            agent_report = coalesce($5::jsonb, agent_report),
            error = $6
      where id = $1`,
    [
      id,
      input.status,
      input.durationMs,
      input.summary ? JSON.stringify(input.summary.findings) : null,
      diag ? JSON.stringify(diag) : null,
      input.error ?? null,
    ],
  );
}

/** Fire-and-forget processing entry point. Never throws to the caller. */
export async function processFreeScan(id: string): Promise<void> {
  const started = Date.now();
  const row = await claimFreeScan(id);
  if (!row) return;

  try {
    const repoFullName = parseRepoFullName(row.repoUrl);
    // Second belt-and-braces public check — the API route already verified,
    // but a repo can flip to private between submission and processing.
    await verifyPublicRepo(repoFullName);
    const { files, entriesSeen, capReached } = await listPublicRepoSourceFiles(repoFullName);

    const summary = runFreeScan({
      repoUrl: row.repoUrl,
      files,
      entriesSeen,
      capReached,
      supabaseUrl: row.supabaseUrl,
      supabaseAnonKey: row.supabaseAnonKey,
    });

    await finishFreeScan(id, {
      status: "succeeded",
      durationMs: Date.now() - started,
      summary,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await finishFreeScan(id, {
      status: "failed",
      durationMs: Date.now() - started,
      error: msg,
    }).catch(() => {
      // If even the finish write fails, log and give up — a cron reaper
      // (issue #NEW-follow-up) will unstick abandoned rows in v2.
      console.error(`free-scan ${id} finish-write failed after error:`, msg);
    });
  }
}
