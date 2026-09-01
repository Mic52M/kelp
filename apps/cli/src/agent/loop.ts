// Agent loop for `kelp scan --agent`.
//
// Emits an AgentEvent stream to a user-supplied callback (typically a
// live TTY renderer that prints one line per event with a timestamp).
// Enforces:
//   - hard cap on iterations (default 24)
//   - hard cap on cost cents (default 100 = $1)
//   - evidence gate on report_finding (delegated to tools.ts)

import type { SourceFile } from "@kelp/core";
import { TOOLS, executeTool, type ExecuteContext } from "./tools.js";
import { buildSystemPrompt, userBrief } from "./prompt.js";
import { createDriver } from "./driver.js";
import { computeCostCents } from "./pricing.js";
import type { AgentEvent, AgentFinding, Cost } from "./types.js";

export interface RunAgentInput {
  apiKey: string;
  model: string;
  target: string;
  root: string;
  files: readonly SourceFile[];
  maxIterations?: number;
  maxCostCents?: number;
  onEvent: (e: AgentEvent) => void;
  /** Overrides the default system prompt — used by the depth/focus options. */
  systemPrompt?: string;
}

export interface RunAgentResult {
  findings: AgentFinding[];
  cost: Cost;
  iterations: number;
  aborted?: string;
}

export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const maxIter = input.maxIterations ?? 24;
  const maxCost = input.maxCostCents ?? 100;

  const driver = createDriver({
    apiKey: input.apiKey,
    model: input.model,
    system: input.systemPrompt ?? buildSystemPrompt(),
    tools: TOOLS,
  });
  const ctx: ExecuteContext = { root: input.root, files: input.files };
  const findings: AgentFinding[] = [];

  const currentCost = (): Cost => {
    const u = driver.getUsage();
    return {
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheReadTokens: u.cacheReadTokens,
      cacheWriteTokens: u.cacheWriteTokens,
      usdCents: computeCostCents({
        model: input.model,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        cacheReadTokens: u.cacheReadTokens,
        cacheWriteTokens: u.cacheWriteTokens,
      }),
    };
  };

  let step = await driver.start(userBrief(input.target, input.files.length));
  let iterations = 1;

  while (true) {
    if (step.assistantText.length > 0) {
      input.onEvent({ kind: "thinking", text: step.assistantText });
    }

    if (step.done) break;

    const results = [];
    for (const call of step.toolCalls) {
      input.onEvent({ kind: "tool_call", name: call.name, input: call.input });
      const res = await executeTool(ctx, call.name, call.input);

      if (call.name === "report_finding" && res.data) {
        const finding = res.data as AgentFinding;
        findings.push(finding);
        input.onEvent({ kind: "finding", finding, verified: true });
      } else if (call.name === "report_finding" && res.isError) {
        input.onEvent({
          kind: "finding",
          finding: {
            ruleId: String(call.input.ruleId ?? "?"),
            title: String(call.input.title ?? "?"),
            severity: (call.input.severity as AgentFinding["severity"]) ?? "medium",
            path: String(call.input.path ?? "?"),
            sourceContains: String(call.input.source_contains ?? ""),
          },
          verified: false,
          reason: res.content,
        });
      }

      // Emit a SAFE-BY-CONSTRUCTION summary. The tool result content
      // (which may include full file bytes for read_file, or matched
      // source lines for grep) never enters the event stream — those
      // would leak the target repo's secrets into the CLI transcript,
      // defeating the purpose of running a security scanner in the
      // first place. The model still receives the full content via the
      // driver conversation; only the human-facing renderer is redacted.
      input.onEvent({
        kind: "tool_result",
        name: call.name,
        summary: safeSummary(call.name, res),
        isError: res.isError,
      });

      results.push({ toolCallId: call.id, content: res.content, isError: res.isError });
    }

    // Enforce caps before spending the next step's tokens.
    const cost = currentCost();
    input.onEvent({
      kind: "cost",
      costUsdCents: cost.usdCents,
      tokensIn: cost.inputTokens,
      tokensOut: cost.outputTokens,
    });
    if (cost.usdCents > maxCost) {
      input.onEvent({
        kind: "aborted",
        reason: `cost cap reached — ${cost.usdCents}¢ > ${maxCost}¢ max. Raise with --max-cost-cents.`,
        cost,
      });
      return { findings, cost, iterations, aborted: "cost-cap" };
    }
    if (iterations >= maxIter) {
      input.onEvent({
        kind: "aborted",
        reason: `iteration cap reached — ${iterations} >= ${maxIter}. Raise with --max-iterations.`,
        cost,
      });
      return { findings, cost, iterations, aborted: "iteration-cap" };
    }

    step = await driver.provideResults(results);
    iterations++;
  }

  const finalCost = currentCost();
  input.onEvent({ kind: "done", findings, cost: finalCost, iterations });
  return { findings, cost: finalCost, iterations };
}

/** Never leak the raw tool output into the transcript. Emit bytes/counts
 *  instead — the model still has the full content, the human sees a shape. */
function safeSummary(toolName: string, res: { content: string; isError: boolean; data?: unknown }): string {
  if (res.isError) {
    return truncOneLine(res.content);
  }
  switch (toolName) {
    case "read_file": {
      // The read_file tool packs the file into a JSON envelope with
      // `content` + `truncated`. Report size only.
      try {
        const parsed = JSON.parse(res.content) as { content?: string; truncated?: boolean };
        const bytes = parsed.content?.length ?? 0;
        const suffix = parsed.truncated ? " (truncated at 200 KB)" : "";
        return `${humanBytes(bytes)}${suffix}`;
      } catch {
        return `${humanBytes(res.content.length)}`;
      }
    }
    case "grep": {
      // Grep result starts with "N match(es):" or "0 matches" — pull the
      // count, drop the payload.
      const m = res.content.match(/^(\d+)\s+match/);
      if (m) return `${m[1]} matches`;
      if (/^0 matches/.test(res.content)) return "0 matches";
      return "matches";
    }
    case "list_files": {
      const lines = res.content.split("\n").filter((l) => l.length > 0);
      const truncated = /\(\+\s*\d+\s+more truncated\)/.test(res.content);
      return `${lines.length}${truncated ? "+" : ""} files`;
    }
    case "report_finding":
      return res.content; // "accepted (verified in path)" — no secrets in there
    default:
      return truncOneLine(res.content);
  }
}

function truncOneLine(s: string): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > 100 ? flat.slice(0, 97) + "…" : flat;
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
