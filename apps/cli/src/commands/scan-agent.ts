// `kelp scan --agent` wiring — reads the target, hands it to the agent
// loop, streams the live transcript, then returns findings + observations
// for the caller to merge into the final report.

import fs from "node:fs/promises";
import path from "node:path";
import { shouldScanPath, type SourceFile } from "@kelp/core";
import { walk } from "../walk.js";
import { runAgent } from "../agent/loop.js";
import { makeEventRenderer } from "../agent/render.js";
import { c } from "../ui/style.js";
import { ruleLabel } from "../ui/rule.js";
import { buildSystemPrompt } from "../agent/prompt.js";
import { resolveDepth, type Depth } from "../agent/depth.js";
import type { AgentFinding } from "../agent/types.js";

const MAX_FILE_BYTES = 1_000_000;

export interface AgentScanOpts {
  target: string;
  apiKey: string;
  depth?: Depth | null;
  model?: string;
  maxCostCents?: number;
  maxIterations?: number;
  focus?: readonly string[] | null;
  observations?: boolean;
  dryRun?: boolean;
}

export interface AgentScanResult {
  findings: AgentFinding[];
  observations: string[];
  costUsdCents: number;
  iterations: number;
  durationMs: number;
  aborted: string | null;
  model: string;
  coverage: { filesRead: number; grepsRun: number; listsRun: number };
}

export async function runAgentScan(opts: AgentScanOpts): Promise<AgentScanResult> {
  const abs = path.resolve(opts.target);
  const preset = resolveDepth(opts.depth ?? null, {
    model: opts.model,
    maxCostCents: opts.maxCostCents,
    maxIterations: opts.maxIterations,
  });

  const stderr = process.stderr;
  stderr.write("\n");
  stderr.write(ruleLabel("AGENT · streaming from Anthropic") + "\n\n");
  stderr.write(
    `  ${c.dim("depth")}          ${c.bold(opts.depth ?? "standard")}\n` +
      `  ${c.dim("model")}          ${c.bold(preset.model)}\n` +
      `  ${c.dim("max cost")}       ${c.bold("$" + (preset.maxCostCents / 100).toFixed(2))}\n` +
      `  ${c.dim("max iter")}       ${c.bold(String(preset.maxIterations))}\n` +
      (opts.focus && opts.focus.length > 0
        ? `  ${c.dim("focus")}          ${c.bold(opts.focus.join(", "))}\n`
        : "") +
      (opts.observations ? `  ${c.dim("observations")}   ${c.bold("on")}\n` : "") +
      `\n`,
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

  if (opts.dryRun) {
    stderr.write(
      `  ${c.gray("dry-run: would scan " + files.length + " files with " + preset.model + " · estimated worst-case cost $" + (preset.maxCostCents / 100).toFixed(2))}\n`,
    );
    return {
      findings: [],
      observations: [],
      costUsdCents: 0,
      iterations: 0,
      durationMs: 0,
      aborted: "dry-run",
      model: preset.model,
      coverage: { filesRead: 0, grepsRun: 0, listsRun: 0 },
    };
  }

  const startedAt = Date.now();
  const observations: string[] = [];
  const onEvent = makeEventRenderer(startedAt);

  const wrappedOnEvent: typeof onEvent = (e) => {
    if (e.kind === "thinking") {
      // Harvest OBSERVATION: markers from the agent's free text.
      const matches = e.text.matchAll(/OBSERVATION:\s*([^\n]+)/g);
      for (const m of matches) observations.push(m[1]!.trim());
    }
    onEvent(e);
  };

  const res = await runAgent({
    apiKey: opts.apiKey,
    model: preset.model,
    target: abs,
    root: abs,
    files,
    maxCostCents: preset.maxCostCents,
    maxIterations: preset.maxIterations,
    onEvent: wrappedOnEvent,
    systemPrompt: buildSystemPrompt({
      focus: opts.focus ?? null,
      depth: opts.depth ?? "standard",
      observations: opts.observations ?? false,
    }),
  });

  return {
    findings: res.findings,
    observations,
    costUsdCents: res.cost.usdCents,
    iterations: res.iterations,
    durationMs: Date.now() - startedAt,
    aborted: res.aborted ?? null,
    model: preset.model,
    coverage: res.coverage,
  };
}
