// Live TTY renderer for agent events. Prints one timestamped line per
// event, colorized by kind. Deliberately not a spinner — spinners rewrite
// the current line, which loses the transcript. The agent's transcript IS
// the value, so every event gets its own persistent line.

import { c } from "../ui/style.js";
import { timestamp } from "../ui/rule.js";
import { severityChip } from "../ui/chip.js";
import type { AgentEvent } from "./types.js";

export function makeEventRenderer(startMs: number) {
  return (e: AgentEvent): void => {
    const ts = c.gray(timestamp(startMs));
    const err = process.stderr;
    switch (e.kind) {
      case "thinking": {
        // Wrap long assistant text loosely.
        const text = e.text.length > 220 ? e.text.slice(0, 217) + "…" : e.text;
        err.write(`${ts} ${c.dim("›")} ${c.italic(text)}\n`);
        break;
      }
      case "tool_call": {
        const summary = summarizeInput(e.name, e.input);
        err.write(`${ts} ${c.cyan("›")} ${c.bold(e.name)}${summary ? c.gray(`  ${summary}`) : ""}\n`);
        break;
      }
      case "tool_result": {
        const glyph = e.isError ? c.red("✗") : c.gray("←");
        err.write(`${ts} ${glyph} ${c.dim(e.summary)}\n`);
        break;
      }
      case "finding": {
        if (e.verified) {
          err.write(
            `${ts} ${severityChip(e.finding.severity)}  ${c.bold(e.finding.title)}  ${c.dim(
              `${e.finding.path}${e.finding.line ? ":" + e.finding.line : ""}`,
            )} ${c.green("✓ verified")}\n`,
          );
        } else {
          err.write(
            `${ts} ${c.red("✗ rejected")}  ${c.dim(e.finding.title)}  ${c.dim(e.reason ?? "")}\n`,
          );
        }
        break;
      }
      case "cost": {
        err.write(
          `${ts} ${c.dim(
            `cost so far: ${(e.costUsdCents / 100).toFixed(3)} · in=${e.tokensIn} out=${e.tokensOut}`,
          )}\n`,
        );
        break;
      }
      case "aborted": {
        err.write(`${ts} ${c.yellow("⚠")} ${c.yellow(e.reason)}\n`);
        break;
      }
      case "done": {
        err.write(
          `${ts} ${c.green("✓")} ${c.bold(`agent done`)}  ${c.dim(
            `${e.findings.length} findings · ${e.iterations} iterations · $${(e.cost.usdCents / 100).toFixed(3)}`,
          )}\n`,
        );
        break;
      }
    }
  };
}

function summarizeInput(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "list_files":
      return input.pattern ? `"${String(input.pattern)}"` : "";
    case "read_file":
      return `"${String(input.path ?? "")}"`;
    case "grep":
      return `/${String(input.pattern ?? "")}/${input.pathPattern ? ` in "${String(input.pathPattern)}"` : ""}`;
    case "report_finding":
      return `${String(input.severity ?? "?")} · ${String(input.title ?? "")}`.slice(0, 100);
    default:
      return "";
  }
}
