// Post-scan agent report block — shown after the ━━ FINDINGS ━━ section
// when --agent was passed. Keeps the same visual grammar (ruled headers,
// severity chips) so the agent output feels like a first-class part of
// the report, not a footnote.

import { c } from "../ui/style.js";
import { ruleLabel } from "../ui/rule.js";
import { severityChip, statusChip } from "../ui/chip.js";
import type { Finding } from "../commands/scan.js";

interface Input {
  findings: Finding[];
  observations: string[];
  costUsdCents: number;
  iterations: number;
  durationMs: number;
  aborted: string | null;
  model: string;
}

export function renderAgentSection(input: Input): void {
  const out = process.stdout;

  // Findings — same visual treatment as static findings.
  out.write(`\n${ruleLabel("AGENT · findings")}\n\n`);
  if (input.findings.length === 0) {
    if (input.aborted) {
      out.write(`  ${statusChip("warn")} ${c.yellow("aborted before finding evidence")} ${c.dim("· " + input.aborted)}\n`);
    } else {
      out.write(`  ${statusChip("ok")} ${c.dim("no findings — the agent inspected the repo and found nothing to file.")}\n`);
    }
  } else {
    const maxLoc = Math.max(...input.findings.map((f) => `${f.path}:${f.line}`.length));
    for (const f of input.findings) {
      const chip = severityChip(f.severity);
      const loc = `${f.path}:${f.line}`.padEnd(maxLoc);
      out.write(`  ${chip}  ${c.dim(loc)}  ${f.title}\n`);
    }
  }

  // Observations — soft hints, not verified findings.
  if (input.observations.length > 0) {
    out.write(`\n${ruleLabel("AGENT · observations (not verified findings)")}\n\n`);
    for (const o of input.observations) {
      out.write(`  ${c.yellow("○")} ${c.dim(o)}\n`);
    }
  }

  // Run summary.
  const seconds = (input.durationMs / 1000).toFixed(1);
  const usd = `$${(input.costUsdCents / 100).toFixed(3)}`;
  out.write(`\n${ruleLabel("AGENT · run summary")}\n\n`);
  out.write(
    `  ${c.dim("model")}          ${c.bold(input.model)}\n` +
      `  ${c.dim("iterations")}     ${c.bold(String(input.iterations))}\n` +
      `  ${c.dim("cost")}           ${c.bold(usd)}\n` +
      `  ${c.dim("duration")}       ${c.bold(seconds + "s")}\n`,
  );
  if (input.aborted) {
    out.write(`  ${c.dim("aborted")}        ${c.yellow(input.aborted)}\n`);
  }
  out.write(`\n`);
}
