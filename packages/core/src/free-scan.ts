// Free scan: the pre-signup, public-repo scan that runs from the landing page.
//
// Positioning invariant (see docs/HANDOFF.md §2 + issue #32): the free scan is
// the top-of-funnel — zero friction, real value, cheap. It is NOT the full
// engine. V1 runs only the deterministic passive scanners (secrets + RLS-from-
// repo). No LLM cost, no test accounts required, no consent gate needed (no
// active probing). V2 will slot in an autonomous agent (repo-only mode) once
// `buildAutonomousCampaign` is refactored to allow no-live-probe operation.
//
// The `runFreeScan` contract is intentionally narrow: it takes source files
// (the caller downloads the repo) and returns a normalized DetectedFinding
// array + a compact summary. No I/O in core — the connectors live in the
// worker where they can talk to GitHub/Supabase.

import { detectSecrets, type SourceFile } from "./scanners/secrets.js";
import { analyzeRls, type SchemaSnapshot, type TableInfo } from "./scanners/rls.js";
import { detectSupabaseConfig, parseRepoSchema } from "./agent/repo-recon.js";
import type { DetectedFinding } from "./orchestrator.js";
import type { Severity } from "./types.js";

/**
 * Detect a Firebase-shaped repo (Firebase Studio, or hand-rolled). Deliberately
 * lightweight — we're only distinguishing "not Supabase" from "not Kelp's
 * target at all". Any of `firebase.json`, `firestore.rules`, `storage.rules`
 * or `.firebaserc` is enough signal.
 */
function detectFirebase(files: readonly SourceFile[]): boolean {
  return files.some((f) =>
    /(?:^|\/)firebase\.json$|(?:^|\/)firestore\.rules$|(?:^|\/)storage\.rules$|(?:^|\/)\.firebaserc$/i.test(f.path),
  );
}

/** Input for a free scan. Files are already downloaded by the caller. */
export interface FreeScanInput {
  /** Canonical repo URL, kept for logging + fingerprint context. */
  repoUrl: string;
  /** All source files from the repo (already filtered by the connector). */
  files: readonly SourceFile[];
  /** Optional — reserved for V2 anon-key probing. Ignored in V1. */
  supabaseUrl?: string | null;
  supabaseAnonKey?: string | null;
  /** How many file entries the tarball actually contained (for diagnostics). */
  entriesSeen?: number;
  /** True if the extractor's non-priority cap kicked in (some files dropped). */
  capReached?: boolean;
}

/**
 * Was this repo one Kelp knows how to reason about? The whole product is
 * scoped to Supabase-backed vibe-coded apps; being honest about "wrong stack"
 * is core to trust — see the honesty rule in docs/HANDOFF.md §2.
 */
export type BackendDetected = "supabase" | "firebase" | "none";

export interface FreeScanSummary {
  /** All findings, most-severe first (same order as runScan). */
  findings: DetectedFinding[];
  /** Breakdown by severity for the /r/<slug> masthead. */
  counts: Record<Severity, number>;
  /** Which sub-scanners actually contributed (audit trail). */
  ranScanners: ("secret" | "rls_from_repo")[];
  /** Notes (info the UI wants to show — e.g. "RLS skipped: no schema in repo"). */
  notes: string[];
  /** Which backend Kelp thinks this repo runs on (see BackendDetected). */
  backendDetected: BackendDetected;
  /** Count of files actually scanned by the deterministic scanners. */
  filesScanned: number;
  /** Count of file entries the tarball contained. 0 if the caller didn't pass it. */
  entriesSeen: number;
  /** True when the extractor's non-priority cap kicked in and the user should know. */
  capReached: boolean;
  /** Count of tables the RLS-from-repo pass parsed from SQL migrations. */
  tablesParsed: number;
}

const SEV_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * Convert the agent-shaped `TableIntel` (from parseRepoSchema) to the
 * `TableInfo` shape `analyzeRls` expects. The two carry the same information,
 * they just came from different subsystems and were never unified.
 *
 *   - Every table sits in the `public` schema (that's what parseRepoSchema
 *     assumes; Supabase migrations that opt into other schemas are rare on
 *     Lovable/Bolt output — treat as unknown, still fine).
 *   - Policies keep their command/roles/using/withCheck fields verbatim.
 *   - Column type strings are preserved so ownership inference (which prefers
 *     uuid-typed columns) still works.
 */
function tableIntelToSchemaSnapshot(
  intel: ReturnType<typeof parseRepoSchema>,
): SchemaSnapshot {
  const tables: TableInfo[] = intel.map((t) => ({
    schema: "public",
    name: t.name,
    columns: t.columns.map((c) => ({ name: c.name, type: c.type })),
    rlsEnabled: t.rlsEnabled,
    policies: t.policies.map((p) => ({
      name: p.name,
      // analyzeRls accepts PolicyCommand — parseRepoSchema outputs the raw
      // string. Coerce to uppercase; anything unusual becomes "ALL" which is
      // the safest interpretation for a coverage check.
      command: normalizeCommand(p.command),
      roles: p.roles,
      usingExpr: p.using,
      withCheckExpr: p.withCheck,
    })),
    isView: false,
  }));
  return { tables };
}

function normalizeCommand(cmd: string): "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL" {
  const u = cmd.toUpperCase();
  if (u === "SELECT" || u === "INSERT" || u === "UPDATE" || u === "DELETE") return u;
  return "ALL";
}

/**
 * Run the free scan against already-downloaded repo files.
 *
 * Deterministic, no LLM, no network from core (caller handles I/O). Cost = $0.
 * Safe to call with any repo content — no user-supplied path is followed off
 * the given file list. Adversarial content in files is data, not instructions.
 */
export function runFreeScan(input: FreeScanInput): FreeScanSummary {
  const findings: DetectedFinding[] = [];
  const ranScanners: FreeScanSummary["ranScanners"] = [];
  const notes: string[] = [];

  // Detect backend up-front so notes can be phrased around it.
  const supaConfig = detectSupabaseConfig(input.files);
  const hasSupabaseSql = input.files.some((f) => /(?:^|\/)supabase\/|\.sql$/i.test(f.path));
  const backendDetected: BackendDetected =
    supaConfig || hasSupabaseSql
      ? "supabase"
      : detectFirebase(input.files)
        ? "firebase"
        : "none";

  if (backendDetected === "firebase") {
    notes.push(
      "Firebase project detected. Kelp's Firebase adapter is on the roadmap — for now only the secret scan applies.",
    );
  } else if (backendDetected === "none") {
    notes.push(
      "No Supabase or Firebase backend detected in this repo. Kelp is built for vibe-coded apps on Supabase — only the generic secret scan applies here.",
    );
  }

  if (input.capReached) {
    notes.push(
      `Large repo — only the first ${input.files.length} security-relevant files were scanned (priority paths like supabase/ and *.sql are always included).`,
    );
  }

  // Secret scan (deterministic).
  try {
    for (const s of detectSecrets(input.files)) {
      findings.push({
        vulnClass: "secret",
        severity: s.severity,
        fingerprint: s.fingerprint,
        title: s.title,
        explanation: `${s.title} found at ${s.path}:${s.line}${s.clientSide ? " (ships to the browser)" : ""}.`,
        location: `${s.path}:${s.line}`,
        fixable: true,
        raw: s,
      });
    }
    ranScanners.push("secret");
  } catch (e) {
    notes.push(`secret scan failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // RLS static from the repo (Lovable Cloud path — no DB access needed).
  let tablesParsed = 0;
  try {
    const intel = parseRepoSchema(input.files);
    tablesParsed = intel.length;
    if (intel.length === 0) {
      if (backendDetected === "supabase") {
        notes.push(
          "Supabase detected but no SQL migrations were found in this repo — Kelp couldn't check RLS statically.",
        );
      }
      // For backendDetected === "none" / "firebase" we already told the user why.
    } else {
      const snapshot = tableIntelToSchemaSnapshot(intel);
      for (const r of analyzeRls(snapshot)) {
        findings.push({
          vulnClass: "rls",
          severity: r.severity,
          fingerprint: r.fingerprint,
          title: r.title,
          explanation: r.explanation,
          location: `${r.schema}.${r.table}`,
          fixable: r.fixable,
          raw: r,
        });
      }
      ranScanners.push("rls_from_repo");
    }
  } catch (e) {
    notes.push(`RLS-from-repo failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  findings.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity]++;

  return {
    findings,
    counts,
    ranScanners,
    notes,
    backendDetected,
    filesScanned: input.files.length,
    entriesSeen: input.entriesSeen ?? 0,
    capReached: !!input.capReached,
    tablesParsed,
  };
}

/**
 * Redact a finding for the pre-email-capture view (partial reveal) and for
 * the public `/r/<slug>` shareable report.
 *
 *   - Keeps: title, class, severity.
 *   - Drops: location (file:line), explanation body, raw payload (which for
 *            secrets includes the masked value + line context).
 *
 * Rationale: on public repos the exact location can be re-derived by anyone
 * with `grep`, so redaction is politeness rather than security — but it also
 * makes the "Get the full report" ask feel meaningful. The paid dashboard
 * (post-signup) shows the un-redacted finding.
 */
export interface RedactedFinding {
  vulnClass: DetectedFinding["vulnClass"];
  severity: Severity;
  fingerprint: string;
  title: string;
}

export function redactFinding(f: DetectedFinding): RedactedFinding {
  return {
    vulnClass: f.vulnClass,
    severity: f.severity,
    fingerprint: f.fingerprint,
    title: f.title,
  };
}
