// `kelp scan --agent` wiring — reads the target, hands it to the agent
// loop, streams the live transcript, then merges the agent's findings
// into the static-scan report.

import fs from "node:fs/promises";
import path from "node:path";
import { shouldScanPath, type SourceFile } from "@kelp/core";
import { walk } from "../walk.js";
import { runAgent } from "../agent/loop.js";
import { makeEventRenderer } from "../agent/render.js";
import { c } from "../ui/style.js";
import { ruleLabel } from "../ui/rule.js";
import type { AgentFinding } from "../agent/types.js";

const MAX_FILE_BYTES = 1_000_000;
const DEFAULT_MODEL = "claude-sonnet-5";

export interface AgentScanOpts {
  target: string;
  apiKey: string;
  model?: string;
  maxCostCents?: number;
  maxIterations?: number;
}

export interface AgentScanResult {
  findings: AgentFinding[];
  costUsdCents: number;
  iterations: number;
  durationMs: number;
  aborted: string | null;
}

export async function runAgentScan(opts: AgentScanOpts): Promise<AgentScanResult> {
  const abs = path.resolve(opts.target);
  const model = opts.model ?? DEFAULT_MODEL;

  const stderr = process.stderr;
  stderr.write("\n");
  stderr.write(ruleLabel("AGENT · streaming from Anthropic") + "\n\n");
  stderr.write(
    `  ${c.dim("model")}          ${c.bold(model)}\n` +
      `  ${c.dim("max cost")}       ${c.bold("$" + ((opts.maxCostCents ?? 100) / 100).toFixed(2))}\n` +
      `  ${c.dim("max iter")}       ${c.bold(String(opts.maxIterations ?? 24))}\n\n`,
  );

  // Load files exactly like the static scan does.
  const allPaths = await walk(abs);
  const candidatePaths = allPaths.filter((p) => shouldScanPath(path.relative(abs, p)));
  const files: SourceFile[] = [];
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

  const startedAt = Date.now();
  const onEvent = makeEventRenderer(startedAt);

  const res = await runAgent({
    apiKey: opts.apiKey,
    model,
    target: abs,
    root: abs,
    files,
    maxCostCents: opts.maxCostCents,
    maxIterations: opts.maxIterations,
    onEvent,
  });

  return {
    findings: res.findings,
    costUsdCents: res.cost.usdCents,
    iterations: res.iterations,
    durationMs: Date.now() - startedAt,
    aborted: res.aborted ?? null,
  };
}
