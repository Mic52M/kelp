// `kelp scan <path>` — full transparent scan.
//
// v0.2.2 opens up what Kelp is actually doing. Every check that runs
// prints its name + rule count. Every check that CAN'T run (because it
// needs a live target, e.g. RLS probing) is listed too, so the empty
// output doesn't feel like a lie. Real findings are still evidence — no
// change to what we call a finding.

import fs from "node:fs/promises";
import path from "node:path";
import {
  detectSecrets,
  shouldScanPath,
  discoverEdgeFunctions,
  type SecretFinding,
  type DiscoveredEdgeFunction,
  type Severity,
  type SourceFile,
} from "@kelp/core";
import { walk } from "../walk.js";
import { detectVerifyJwt, type VerifyJwtFinding } from "../checks/verify-jwt.js";
import { loadConfig } from "../config.js";
import { renderReport } from "../output/report.js";

interface ScanOptions {
  path: string;
  json: boolean;
  minSeverity: string | null;
  verbose: boolean;
  version: string;
}

const SEV_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const MAX_FILE_BYTES = 1_000_000;

// Unified finding shape for output. Preserves everything a downstream tool
// (or the hosted app) needs to dedup + display.
export interface Finding {
  fingerprint: string;
  ruleId: string;
  title: string;
  severity: Severity;
  path: string;
  line: number;
  preview?: string;
  provider?: string;
  confidence?: "high" | "medium";
  clientSide?: boolean;
  source: "secrets" | "supabase-config";
}

function isSeverity(v: string): v is Severity {
  return v === "critical" || v === "high" || v === "medium" || v === "low";
}

function progress(msg: string, verbose: boolean): void {
  if (verbose) process.stderr.write(`  · ${msg}\n`);
}

export async function runScan(opts: ScanOptions): Promise<void> {
  const abs = path.resolve(opts.path);

  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    process.stderr.write(`kelp scan: path not found: ${opts.path}\n`);
    process.exit(2);
  }
  if (!stat.isDirectory()) {
    process.stderr.write(`kelp scan: ${opts.path} is not a directory\n`);
    process.exit(2);
  }

  if (opts.minSeverity && !isSeverity(opts.minSeverity)) {
    process.stderr.write(
      `kelp scan: invalid --severity value "${opts.minSeverity}". ` +
        `Use critical, high, medium, or low.\n`,
    );
    process.exit(2);
  }

  const config = loadConfig();
  const startedAt = Date.now();

  // ── walk ────────────────────────────────────────────────────────────
  progress(`walking ${abs}`, opts.verbose);
  const allPaths = await walk(abs);
  const candidatePaths = allPaths.filter((p) => shouldScanPath(path.relative(abs, p)));
  progress(`${allPaths.length} paths walked, ${candidatePaths.length} eligible`, opts.verbose);

  // ── read ────────────────────────────────────────────────────────────
  const files: SourceFile[] = [];
  let skippedBig = 0;
  let skippedUnreadable = 0;
  for (const p of candidatePaths) {
    try {
      const s = await fs.stat(p);
      if (s.size > MAX_FILE_BYTES) {
        skippedBig++;
        continue;
      }
      const content = await fs.readFile(p, "utf8");
      files.push({ path: path.relative(abs, p), content });
    } catch {
      skippedUnreadable++;
    }
  }
  progress(
    `${files.length} read, ${skippedBig} skipped (>1MB), ${skippedUnreadable} unreadable`,
    opts.verbose,
  );

  // ── checks ──────────────────────────────────────────────────────────
  // Every check emits its own step so the caller sees what actually ran,
  // and a `ranOn`/`applicable` flag so we can say "n/a — no config.toml"
  // instead of pretending we scanned something we didn't.

  progress("running SEC-001 (secret patterns + entropy)", opts.verbose);
  const secretFindings: SecretFinding[] = detectSecrets(files);

  const hasSupabaseConfig = files.some((f) => /supabase\/config\.toml$/i.test(f.path));
  progress(
    `running EDGE-003 (verify_jwt=false in supabase/config.toml) — ${hasSupabaseConfig ? "applicable" : "n/a"}`,
    opts.verbose,
  );
  const verifyJwtFindings: VerifyJwtFinding[] = hasSupabaseConfig
    ? detectVerifyJwt(files)
    : [];

  const hasEdgeFns = files.some((f) => /supabase\/functions\//i.test(f.path));
  progress(
    `running edge-fn recon (informational) — ${hasEdgeFns ? "applicable" : "n/a"}`,
    opts.verbose,
  );
  const edgeFns: DiscoveredEdgeFunction[] = hasEdgeFns
    ? discoverEdgeFunctions(files)
    : [];

  // ── merge + filter + sort ───────────────────────────────────────────
  let findings: Finding[] = [
    ...secretFindings.map<Finding>((f) => ({
      fingerprint: f.fingerprint,
      ruleId: f.ruleId,
      title: f.title,
      severity: f.severity,
      path: f.path,
      line: f.line,
      preview: f.preview,
      provider: f.provider,
      confidence: f.confidence,
      clientSide: f.clientSide,
      source: "secrets",
    })),
    ...verifyJwtFindings.map<Finding>((f) => ({
      fingerprint: f.fingerprint,
      ruleId: f.ruleId,
      title: f.title,
      severity: f.severity,
      path: f.path,
      line: f.line,
      source: "supabase-config",
    })),
  ];

  if (opts.minSeverity) {
    const min = opts.minSeverity as Severity;
    findings = findings.filter((f) => SEV_ORDER[f.severity] <= SEV_ORDER[min]);
  }
  findings.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

  const durationMs = Date.now() - startedAt;

  if (opts.json) {
    const report = {
      version: 2,
      tool: { name: "kelp", version: opts.version },
      target: abs,
      scannedAt: new Date().toISOString(),
      filesScanned: files.length,
      filesSkipped: { oversize: skippedBig, unreadable: skippedUnreadable },
      checks: {
        secrets: { applicable: true, findings: secretFindings.length },
        supabaseConfigVerifyJwt: {
          applicable: hasSupabaseConfig,
          findings: verifyJwtFindings.length,
        },
        edgeFnRecon: {
          applicable: hasEdgeFns,
          discovered: edgeFns.length,
          mutating: edgeFns.filter((e) => e.mutating).length,
        },
      },
      durationMs,
      findings,
    };
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    renderReport({
      version: opts.version,
      target: opts.path,
      filesScanned: files.length,
      pathsWalked: allPaths.length,
      checks: {
        secretsApplicable: true,
        supabaseConfigApplicable: hasSupabaseConfig,
        edgeFnReconApplicable: hasEdgeFns,
      },
      findings,
      edgeFns,
      durationMs,
      config,
    });
  }

  process.exit(findings.length === 0 ? 0 : 1);
}
