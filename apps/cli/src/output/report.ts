// The scan result renderer. Prints one coherent block: what target was
// scanned, what checks ran (and which didn't apply and why), the findings,
// any informational observations, and next-step hints. Ollama-style: dense
// but scannable.

import type { DiscoveredEdgeFunction, Severity } from "@kelp/core";
import type { Finding } from "../commands/scan.js";
import type { KelpConfig } from "../config.js";

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
const SEV_LABEL: Record<Severity, string> = {
  critical: "CRITICAL",
  high: "HIGH    ",
  medium: "MEDIUM  ",
  low: "LOW     ",
};

const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;

function col(s: string, code: string): string {
  return USE_COLOR ? `${code}${s}${RESET}` : s;
}

function sectionHeader(label: string): string {
  return col(`▶ ${label}`, BOLD);
}

interface RenderInput {
  version: string;
  target: string;
  filesScanned: number;
  pathsWalked: number;
  checks: {
    secretsApplicable: boolean;
    supabaseConfigApplicable: boolean;
    edgeFnReconApplicable: boolean;
  };
  findings: Finding[];
  edgeFns: DiscoveredEdgeFunction[];
  durationMs: number;
  config: KelpConfig;
}

export function renderReport(input: RenderInput): void {
  const {
    version,
    target,
    filesScanned,
    pathsWalked,
    checks,
    findings,
    edgeFns,
    durationMs,
    config,
  } = input;
  const seconds = (durationMs / 1000).toFixed(1);

  const out = process.stdout;
  out.write("\n");
  out.write(`${col("kelp", BOLD)} v${version}\n`);
  out.write("\n");

  // ── Target + walk stats ─────────────────────────────────────────────
  out.write(`${sectionHeader("Target")}         ${target}\n`);
  out.write(
    `${sectionHeader("Files walked")}   ${filesScanned}  ${col(
      `(from ${pathsWalked} total paths, ${pathsWalked - filesScanned} filtered out)`,
      DIM,
    )}\n`,
  );

  // ── Checks that ran (or didn't, and why) ────────────────────────────
  out.write("\n");
  out.write(`${sectionHeader("Checks run")}\n`);
  out.write(
    `  ${checkBullet(checks.secretsApplicable)}  ${col("SEC-001", DIM)}   secret patterns + entropy fallback ${countSuffix(
      findings.filter((f) => f.source === "secrets").length,
    )}\n`,
  );
  out.write(
    `  ${checkBullet(checks.supabaseConfigApplicable)}  ${col("EDGE-003", DIM)}  verify_jwt=false in supabase/config.toml ${
      checks.supabaseConfigApplicable
        ? countSuffix(findings.filter((f) => f.source === "supabase-config").length)
        : col("(n/a — no supabase/config.toml)", DIM)
    }\n`,
  );
  out.write(
    `  ${checkBullet(checks.edgeFnReconApplicable)}  ${col("RECON  ", DIM)}   edge function discovery ${
      checks.edgeFnReconApplicable
        ? col(`(${edgeFns.length} functions, ${edgeFns.filter((e) => e.mutating).length} mutating)`, DIM)
        : col("(n/a — no supabase/functions/)", DIM)
    }\n`,
  );

  // ── Findings ────────────────────────────────────────────────────────
  out.write("\n");
  if (findings.length === 0) {
    out.write(`${sectionHeader("Findings")}\n`);
    out.write(`  ${col("✓ clean", GREEN)} — no findings from the checks above.\n`);
  } else {
    out.write(`${sectionHeader("Findings")}       ${col(`${findings.length}`, BOLD)}\n\n`);
    const maxLoc = Math.max(...findings.map((f) => `${f.path}:${f.line}`.length));
    for (const f of findings) {
      const sev = col(SEV_LABEL[f.severity], SEV_COLOR[f.severity]);
      const loc = `${f.path}:${f.line}`.padEnd(maxLoc);
      const tail = f.preview ? "  " + col(`(${f.preview})`, DIM) : "";
      out.write(`  ${sev}  ${col(loc, DIM)}  ${f.title}${tail}\n`);
    }
    out.write("\n");
    out.write(`  ${summaryLine(findings)}\n`);
  }

  // ── Info block (edge-fn discovery, non-findings) ────────────────────
  if (edgeFns.length > 0) {
    const mutating = edgeFns.filter((e) => e.mutating);
    const safe = edgeFns.filter((e) => !e.mutating);
    out.write("\n");
    out.write(`${sectionHeader("Info")}\n`);
    out.write(
      `  Discovered ${col(`${edgeFns.length}`, BOLD)} Supabase edge functions in supabase/functions/.\n`,
    );
    if (mutating.length > 0) {
      out.write(
        `  ${col(`${mutating.length}`, DIM)} are mutating and are ${col("skipped by design", DIM)} in any probe mode\n`,
      );
      out.write(`  ${col("(delete/create/charge names or bodies that write to the DB).", DIM)}\n`);
    }
    if (safe.length > 0) {
      out.write(
        `  ${col(`${safe.length}`, DIM)} are non-mutating and would be probed against a live target — ` +
          `${col("use the hosted app at kelp.build for that.", DIM)}\n`,
      );
    }
  }

  // ── Next-step hints ─────────────────────────────────────────────────
  out.write("\n");
  out.write(`${sectionHeader("What Kelp cannot catch offline")}\n`);
  out.write(
    `  The CLI runs the ${col("static", BOLD)} checks — anything that only needs your\n` +
      `  source tree. The deeper checks below need a live target and aren't\n` +
      `  in the CLI yet:\n`,
  );
  out.write(`    ${col("RLS-002", DIM)}   live RLS probing over PostgREST (needs Supabase URL + anon key)\n`);
  out.write(`    ${col("EDGE-003", DIM)}  edge-fn replay without JWT (needs the deployed URL)\n`);
  out.write(`    ${col("BOLA-004", DIM)}  broken object-level authz (needs two test accounts + consent)\n`);
  out.write(`    ${col("AGENT-∞ ", DIM)}  multi-specialist agent squad (needs ANTHROPIC_API_KEY)\n`);
  out.write("\n");
  if (config.anthropicApiKey) {
    out.write(
      `  ${col("✓", GREEN)} ${col(`ANTHROPIC_API_KEY detected (${config.source}).`, DIM)}\n` +
        `  ${col("Agent-driven scans arrive in the next minor release — hosted app has it today.", DIM)}\n`,
    );
  } else {
    out.write(
      `  ${col("Set", DIM)} ${col("ANTHROPIC_API_KEY", BOLD)} ${col(
        "in your env to enable the agent-driven scan (coming soon),",
        DIM,
      )}\n` +
        `  ${col("or use the hosted app at ", DIM)}${col("https://kelp.build", BOLD)}${col(
          " for the full pipeline today.",
          DIM,
        )}\n`,
    );
  }

  out.write("\n");
  out.write(`${col(`done in ${seconds}s`, DIM)}\n`);
}

function checkBullet(applicable: boolean): string {
  return applicable ? col("·", GREEN) : col("·", GRAY);
}

function countSuffix(n: number): string {
  return col(`(${n} ${n === 1 ? "finding" : "findings"})`, DIM);
}

function summaryLine(findings: Finding[]): string {
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
  return `Summary  ${parts.join("  ·  ")}`;
}
