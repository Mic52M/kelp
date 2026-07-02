// Scan orchestration: the glue that runs the three checks against a project and
// returns a normalized set of findings. Connectors are interfaces so the worker
// can inject real GitHub/Supabase implementations (which need API credentials)
// while tests and local dev inject mocks. BOLA only runs through the consent
// guard — there is no way to reach it here without valid consent.

import type { Severity, VulnClass } from "./types.js";
import { detectSecrets, type SourceFile, type SecretFinding } from "./scanners/secrets.js";
import { analyzeRls, type SchemaSnapshot, type RlsFinding } from "./scanners/rls.js";
import { buildBolaReport, type BolaProbeResult, type BolaReport } from "./remediation/bola-report.js";
import { runWithActiveTestConsent, type ConsentStore, type AuditLogger } from "./consent.js";

export interface GitHubConnector {
  /** already-filtered source files for the repo (secret scan input). */
  listSourceFiles(repoFullName: string): Promise<SourceFile[]>;
}

export interface SupabaseConnector {
  /** schema snapshot from the Management API (RLS input). */
  getSchemaSnapshot(projectRef: string): Promise<SchemaSnapshot>;
}

export interface BolaConnector {
  /** actively probe endpoints with two authorized test sessions. */
  probe(projectId: string): Promise<BolaProbeResult[]>;
}

/** Unified finding shape the app/DB layer persists. */
export interface DetectedFinding {
  vulnClass: VulnClass;
  severity: Severity;
  fingerprint: string;
  title: string;
  explanation: string;
  location: string | null;
  fixable: boolean;
  /** class-specific payload (secret preview, rls issue, bola report). */
  raw: SecretFinding | RlsFinding | BolaReport;
}

export interface ScanInput {
  orgId: string;
  projectId: string;
  repoFullName: string | null;
  supabaseRef: string | null;
  classes: VulnClass[];
  jobId: string;
}

export interface ScanDeps {
  github?: GitHubConnector;
  supabase?: SupabaseConnector;
  bola?: BolaConnector;
  consent: ConsentStore;
  audit: AuditLogger;
}

const SEV_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * Run the requested checks and return findings, most-severe first. Each class is
 * independent: a missing connector or a failure in one class does not abort the
 * others (its error is collected). BOLA is gated by consent.
 */
export async function runScan(
  input: ScanInput,
  deps: ScanDeps,
): Promise<{ findings: DetectedFinding[]; errors: { vulnClass: VulnClass; message: string }[] }> {
  const findings: DetectedFinding[] = [];
  const errors: { vulnClass: VulnClass; message: string }[] = [];

  if (input.classes.includes("secret") && deps.github && input.repoFullName) {
    try {
      const files = await deps.github.listSourceFiles(input.repoFullName);
      await deps.audit.record({
        orgId: input.orgId,
        projectId: input.projectId,
        actorType: "worker",
        actorId: input.jobId,
        action: "read_repo",
        resource: input.repoFullName,
        metadata: { fileCount: files.length },
      });
      for (const s of detectSecrets(files)) {
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
    } catch (e) {
      errors.push({ vulnClass: "secret", message: String(e instanceof Error ? e.message : e) });
    }
  }

  if (input.classes.includes("rls") && deps.supabase && input.supabaseRef) {
    try {
      const snapshot = await deps.supabase.getSchemaSnapshot(input.supabaseRef);
      await deps.audit.record({
        orgId: input.orgId,
        projectId: input.projectId,
        actorType: "worker",
        actorId: input.jobId,
        action: "read_schema",
        resource: input.supabaseRef,
        metadata: { tableCount: snapshot.tables.length },
      });
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
    } catch (e) {
      errors.push({ vulnClass: "rls", message: String(e instanceof Error ? e.message : e) });
    }
  }

  if (input.classes.includes("bola") && deps.bola) {
    try {
      // Consent gate: throws ConsentRequiredError if not authorized.
      const probes = await runWithActiveTestConsent(
        { store: deps.consent, audit: deps.audit },
        { orgId: input.orgId, projectId: input.projectId, actorId: input.jobId, action: "bola_probe" },
        () => deps.bola!.probe(input.projectId),
      );
      for (const p of probes) {
        const report = buildBolaReport(p);
        if (!report) continue;
        findings.push({
          vulnClass: "bola",
          severity: report.severity,
          fingerprint: report.fingerprint,
          title: report.title,
          explanation: report.evidence,
          location: report.endpoint,
          fixable: false, // MVP: human review, no auto-fix
          raw: report,
        });
      }
    } catch (e) {
      errors.push({ vulnClass: "bola", message: String(e instanceof Error ? e.message : e) });
    }
  }

  findings.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  return { findings, errors };
}
