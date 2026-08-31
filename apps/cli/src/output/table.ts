// Human-facing scan output. Colours only when stdout is a TTY and NO_COLOR
// isn't set — the ANSI codes never end up in a piped file.

import type { SecretFinding, Severity } from "@kelp/core";

const SEV_LABEL: Record<Severity, string> = {
  critical: "CRITICAL",
  high: "HIGH    ",
  medium: "MEDIUM  ",
  low: "LOW     ",
};

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const GRAY = "\x1b[90m";
const GREEN = "\x1b[32m";

const SEV_COLOR: Record<Severity, string> = {
  critical: RED,
  high: YELLOW,
  medium: BLUE,
  low: GRAY,
};

const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;

function col(s: string, code: string): string {
  return USE_COLOR ? `${code}${s}${RESET}` : s;
}

export function printTable(input: {
  version: string;
  target: string;
  filesScanned: number;
  durationMs: number;
  findings: SecretFinding[];
}): void {
  const { version, target, filesScanned, durationMs, findings } = input;
  const seconds = (durationMs / 1000).toFixed(1);

  process.stdout.write("\n");
  process.stdout.write(
    `${col("kelp", BOLD)} v${version}  ·  scanning ${target}  ·  ${filesScanned} files walked\n\n`,
  );

  if (findings.length === 0) {
    process.stdout.write(col("no findings.\n", GREEN));
    process.stdout.write("\n");
    process.stdout.write(col(`done in ${seconds}s\n`, DIM));
    return;
  }

  const maxLoc = Math.max(...findings.map((f) => `${f.path}:${f.line}`.length));

  for (const f of findings) {
    const sev = col(SEV_LABEL[f.severity], SEV_COLOR[f.severity]);
    const loc = `${f.path}:${f.line}`.padEnd(maxLoc);
    const tail = f.preview ? "  " + col(`(${f.preview})`, DIM) : "";
    process.stdout.write(`${sev}  ${col(loc, DIM)}  ${f.title}${tail}\n`);
  }

  const counts = {
    critical: findings.filter((f) => f.severity === "critical").length,
    high: findings.filter((f) => f.severity === "high").length,
    medium: findings.filter((f) => f.severity === "medium").length,
    low: findings.filter((f) => f.severity === "low").length,
  };

  const parts: string[] = [];
  if (counts.critical > 0) parts.push(col(`${counts.critical} critical`, RED));
  if (counts.high > 0) parts.push(col(`${counts.high} high`, YELLOW));
  if (counts.medium > 0) parts.push(col(`${counts.medium} medium`, BLUE));
  if (counts.low > 0) parts.push(col(`${counts.low} low`, GRAY));

  process.stdout.write("\n");
  process.stdout.write(
    `${findings.length} finding${findings.length === 1 ? "" : "s"}  ·  ${parts.join(", ")}  ·  ${seconds}s\n`,
  );
}
