// Scan result renderer — Kelp CLI's main visible output.
//
// Structure (top to bottom, always in the same order):
//   1. banner (once per run)
//   2. ━━ TARGET ━━ header + target + walk stats
//   3. ━━ CHECKS ━━ what ran, with rule counts + n/a reasons
//   4. ━━ FINDINGS ━━ colored severity chips + preview
//   5. ━━ INFO ━━ non-findings observations (edge fn discovery)
//   6. ━━ NEXT ━━ live-check hints + agent-mode hint
//   7. done timing

import type { DiscoveredEdgeFunction, Severity } from "@kelp/core";
import type { Finding } from "../commands/scan.js";
import type { KelpConfig } from "../config.js";
import { c } from "../ui/style.js";
import { ruleLabel } from "../ui/rule.js";
import { severityChip, statusChip } from "../ui/chip.js";
import { banner } from "../ui/banner.js";

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
  const out = process.stdout;
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

  out.write(banner(version));

  // ── TARGET ─────────────────────────────────────────────────────────
  out.write(`${ruleLabel("TARGET")}\n\n`);
  out.write(`  ${c.dim("path")}          ${target}\n`);
  const filtered = pathsWalked - filesScanned;
  out.write(
    `  ${c.dim("files")}         ${c.bold(String(filesScanned))} ${c.dim(
      `(${pathsWalked} walked, ${filtered} filtered)`,
    )}\n`,
  );
  out.write(`\n`);

  // ── CHECKS ─────────────────────────────────────────────────────────
  out.write(`${ruleLabel("CHECKS")}\n\n`);
  writeCheckRow(
    "SEC-001",
    "hardcoded secrets — provider patterns + entropy",
    checks.secretsApplicable,
    checks.secretsApplicable ? findings.filter((f) => f.source === "secrets").length : null,
    null,
  );
  writeCheckRow(
    "EDGE-003",
    "verify_jwt=false in supabase/config.toml",
    checks.supabaseConfigApplicable,
    checks.supabaseConfigApplicable
      ? findings.filter((f) => f.source === "supabase-config").length
      : null,
    checks.supabaseConfigApplicable ? null : "no supabase/config.toml in target",
  );
  const edgeMutating = edgeFns.filter((e) => e.mutating).length;
  writeCheckRow(
    "RECON",
    "edge function discovery",
    checks.edgeFnReconApplicable,
    null,
    checks.edgeFnReconApplicable
      ? `${edgeFns.length} functions · ${edgeMutating} mutating`
      : "no supabase/functions/ in target",
  );
  out.write(`\n`);

  // ── FINDINGS ───────────────────────────────────────────────────────
  out.write(`${ruleLabel("FINDINGS")}\n\n`);
  if (findings.length === 0) {
    out.write(`  ${statusChip("ok")} ${c.dim("no findings from the checks above.")}\n\n`);
  } else {
    const maxLoc = Math.max(...findings.map((f) => `${f.path}:${f.line}`.length));
    for (const f of findings) {
      const chip = severityChip(f.severity);
      const loc = `${f.path}:${f.line}`.padEnd(maxLoc);
      const preview = f.preview ? " " + c.dim(`(${f.preview})`) : "";
      out.write(`  ${chip}  ${c.dim(loc)}  ${f.title}${preview}\n`);
    }
    out.write(`\n  ${summaryLine(findings)}\n\n`);
  }

  // ── INFO (edge fn discovery, non-findings) ─────────────────────────
  if (edgeFns.length > 0) {
    out.write(`${ruleLabel("INFO · edge functions discovered")}\n\n`);
    for (const e of edgeFns) {
      const badge = e.mutating
        ? c.gray("● mutating · skipped")
        : c.cyan("● non-mutating · probable via hosted app");
      out.write(`  ${badge}   ${c.bold(e.name)}  ${c.dim(e.path)}\n`);
    }
    out.write(`\n`);
  }

  // ── NEXT (live-check hints + agent) ────────────────────────────────
  out.write(`${ruleLabel("NEXT · what the CLI does NOT catch offline")}\n\n`);
  out.write(
    `  ${c.dim("The CLI runs static checks — anything that only needs your source.")}\n`,
  );
  out.write(
    `  ${c.dim("These need a live target and aren't in the CLI yet:")}\n\n`,
  );
  out.write(
    `    ${c.dim("RLS-002")}    ${c.dim("live RLS probing over PostgREST")}\n` +
      `    ${c.dim("EDGE-003")}   ${c.dim("edge-fn replay without JWT (needs deployed URL)")}\n` +
      `    ${c.dim("BOLA-004")}   ${c.dim("broken object-level authz (needs two test accounts + consent)")}\n` +
      `    ${c.dim("AGENT-∞")}    ${c.dim("multi-specialist agent squad (needs ANTHROPIC_API_KEY)")}\n\n`,
  );

  if (config.anthropicApiKey) {
    out.write(
      `  ${statusChip("ok")} ${c.dim(`ANTHROPIC_API_KEY detected (${config.source}).`)}\n` +
        `  ${c.dim("Agent-driven scans land in the next release; hosted app runs them today.")}\n`,
    );
  } else {
    out.write(
      `  ${c.dim("Set")} ${c.bold("ANTHROPIC_API_KEY")} ${c.dim("for the coming agent mode, or use")} ${c.bold(
        "https://kelp.build",
      )} ${c.dim("today.")}\n`,
    );
  }
  out.write(`\n`);

  // ── done ───────────────────────────────────────────────────────────
  const seconds = (durationMs / 1000).toFixed(2);
  out.write(`  ${c.dim(`done in ${seconds}s`)}\n`);
}

function writeCheckRow(
  id: string,
  desc: string,
  applicable: boolean,
  findingCount: number | null,
  reason: string | null,
): void {
  const out = process.stdout;
  const chip = applicable
    ? findingCount !== null && findingCount > 0
      ? statusChip("warn")
      : statusChip("ok")
    : statusChip("skip");
  const idBlock = c.dim(id.padEnd(9));
  let tail = "";
  if (applicable && findingCount !== null) {
    tail = c.dim(`· ${findingCount} ${findingCount === 1 ? "finding" : "findings"}`);
  } else if (reason) {
    tail = c.dim(`· ${reason}`);
  }
  out.write(`  ${chip}  ${idBlock} ${desc}  ${tail}\n`);
}

function summaryLine(findings: Finding[]): string {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity]++;
  const parts: string[] = [];
  if (counts.critical > 0) parts.push(c.red(`${counts.critical} critical`));
  if (counts.high > 0) parts.push(c.yellow(`${counts.high} high`));
  if (counts.medium > 0) parts.push(c.blue(`${counts.medium} medium`));
  if (counts.low > 0) parts.push(c.gray(`${counts.low} low`));
  return `${c.dim("summary")}  ${parts.join(c.dim("  ·  "))}`;
}
