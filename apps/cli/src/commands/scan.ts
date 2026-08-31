// `kelp scan <path>` — walk a local directory, run @kelp/core's secret
// scanner over the eligible files, then either pretty-print a summary or
// emit a JSON report (--json).
//
// Exit codes match POSIX-style tool conventions:
//   0  scan completed, no findings above the severity floor
//   1  scan completed, at least one finding above the floor
//   2  scan itself failed (bad path, unreadable target, etc.)

import fs from "node:fs/promises";
import path from "node:path";
import {
  detectSecrets,
  shouldScanPath,
  type SecretFinding,
  type Severity,
} from "@kelp/core";
import { walk } from "../walk.js";
import { printTable } from "../output/table.js";

interface ScanOptions {
  path: string;
  json: boolean;
  minSeverity: string | null;
  version: string;
}

const SEV_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const MAX_FILE_BYTES = 1_000_000; // skip files > 1 MB (asset dumps, minified bundles)

function isSeverity(v: string): v is Severity {
  return v === "critical" || v === "high" || v === "medium" || v === "low";
}

export async function runScan(opts: ScanOptions): Promise<void> {
  const abs = path.resolve(opts.path);

  // Verify the target exists and is a directory before we start walking.
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

  const startedAt = Date.now();

  const allPaths = await walk(abs);
  const candidatePaths = allPaths.filter((p) => shouldScanPath(path.relative(abs, p)));

  // Read files. Unreadable / binary / oversized are silently skipped so a
  // single bad file never fails the whole scan.
  const files: { path: string; content: string }[] = [];
  for (const p of candidatePaths) {
    try {
      const s = await fs.stat(p);
      if (s.size > MAX_FILE_BYTES) continue;
      const content = await fs.readFile(p, "utf8");
      files.push({ path: path.relative(abs, p), content });
    } catch {
      /* unreadable — skip */
    }
  }

  let findings: SecretFinding[] = detectSecrets(files);

  if (opts.minSeverity) {
    const min = opts.minSeverity as Severity;
    findings = findings.filter((f) => SEV_ORDER[f.severity] <= SEV_ORDER[min]);
  }
  findings.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

  const durationMs = Date.now() - startedAt;

  if (opts.json) {
    const report = {
      version: 1,
      tool: { name: "kelp", version: opts.version },
      target: abs,
      scannedAt: new Date().toISOString(),
      filesScanned: files.length,
      durationMs,
      findings,
    };
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    printTable({
      version: opts.version,
      target: opts.path,
      filesScanned: files.length,
      durationMs,
      findings,
    });
  }

  process.exit(findings.length === 0 ? 0 : 1);
}
