// Tool definitions handed to the agent + their local executor.
//
// The agent's toolbox is intentionally small and read-only. Everything the
// agent can do is either "inspect the target repo" or "propose a finding".
// No shell, no HTTP (yet), no writes to the filesystem.
//
// Evidence gating lives here: report_finding is REJECTED unless the
// agent-supplied `source_contains` string is actually found at the claimed
// path. That's the anti-fabrication invariant made mechanical.

import fs from "node:fs/promises";
import path from "node:path";
import type { AgentFinding } from "./types.js";

const MAX_READ_BYTES = 200_000;
const MAX_GREP_HITS = 40;

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export const TOOLS: ToolSpec[] = [
  {
    name: "list_files",
    description:
      "List files in the target repo. Returns paths relative to the target root. Optional glob-like pattern (e.g. 'supabase/**/*.ts' or '*.toml') restricts the result. Prefer this over guessing paths.",
    input_schema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description:
            "Optional glob-ish pattern. '**' matches any depth. '*' matches any single segment. Case-insensitive.",
        },
      },
    },
  },
  {
    name: "read_file",
    description:
      "Read a file's contents. Path is relative to the target root. Text files only; truncates at 200 KB. Returns { content, truncated }.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
    },
  },
  {
    name: "grep",
    description:
      "Search a regex across the repo's source (relative to the target root). Returns up to 40 matches with path + line + text. Use before reading many files.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "JavaScript regex source (no /flags/)." },
        pathPattern: {
          type: "string",
          description: "Optional glob-ish filter on file paths, same syntax as list_files.",
        },
        caseInsensitive: { type: "boolean", description: "Default false." },
      },
      required: ["pattern"],
    },
  },
  {
    name: "report_finding",
    description:
      "Report a confirmed security finding. Kelp REJECTS the finding unless `source_contains` is actually present at `path` — this is the evidence gate. Do not report a finding until you have both a specific location and a citable substring.",
    input_schema: {
      type: "object",
      properties: {
        ruleId: {
          type: "string",
          description: "Short kebab-case identifier for the rule you're firing (e.g. 'edge-fn-verify-jwt-false').",
        },
        title: { type: "string", description: "One-line human-readable title." },
        severity: {
          type: "string",
          enum: ["critical", "high", "medium", "low"],
        },
        path: {
          type: "string",
          description: "File path (relative to target root) where the evidence lives.",
        },
        line: { type: "integer", description: "Optional line number." },
        fix: { type: "string", description: "Short suggested fix (one sentence)." },
        source_contains: {
          type: "string",
          description:
            "Exact substring that MUST appear at `path`. If it doesn't, the finding is rejected — no exceptions.",
        },
      },
      required: ["ruleId", "title", "severity", "path", "source_contains"],
    },
  },
];

/** Glob-ish pattern matcher. Supports `**`, `*`, and literal segments.
 *  Deliberately not a full glob library — the agent's patterns are simple. */
function globToRe(pattern: string, caseInsensitive = true): RegExp {
  let re = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/]*";
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch;
    }
  }
  re += "$";
  return new RegExp(re, caseInsensitive ? "i" : "");
}

export interface ExecuteContext {
  root: string;
  files: readonly { path: string; content: string }[];
}

export interface ToolResult {
  content: string;
  isError: boolean;
  /** Structured payload for callers that need to introspect (e.g. findings). */
  data?: unknown;
}

export async function executeTool(
  ctx: ExecuteContext,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    if (name === "list_files") {
      const pattern = typeof input.pattern === "string" ? input.pattern : null;
      const re = pattern ? globToRe(pattern) : null;
      const matches = ctx.files.filter((f) => (re ? re.test(f.path) : true)).map((f) => f.path);
      const capped = matches.slice(0, 200);
      const suffix = matches.length > capped.length ? `\n(+ ${matches.length - capped.length} more truncated)` : "";
      return { content: capped.join("\n") + suffix, isError: false };
    }

    if (name === "read_file") {
      const rel = typeof input.path === "string" ? input.path : "";
      if (!rel) return { content: "missing path", isError: true };
      const abs = path.resolve(ctx.root, rel);
      if (!abs.startsWith(path.resolve(ctx.root))) {
        return { content: "path escapes target root", isError: true };
      }
      try {
        const stat = await fs.stat(abs);
        if (!stat.isFile()) return { content: "not a file", isError: true };
        const content = await fs.readFile(abs, "utf8");
        const truncated = content.length > MAX_READ_BYTES;
        return {
          content: JSON.stringify({
            content: truncated ? content.slice(0, MAX_READ_BYTES) : content,
            truncated,
          }),
          isError: false,
        };
      } catch (e) {
        return { content: `read failed: ${e instanceof Error ? e.message : String(e)}`, isError: true };
      }
    }

    if (name === "grep") {
      const patternStr = typeof input.pattern === "string" ? input.pattern : "";
      if (!patternStr) return { content: "missing pattern", isError: true };
      const pathPattern = typeof input.pathPattern === "string" ? input.pathPattern : null;
      const ci = input.caseInsensitive === true;
      let re: RegExp;
      try {
        re = new RegExp(patternStr, ci ? "gi" : "g");
      } catch (e) {
        return { content: `invalid regex: ${e instanceof Error ? e.message : String(e)}`, isError: true };
      }
      const pathRe = pathPattern ? globToRe(pathPattern) : null;
      const hits: string[] = [];
      for (const f of ctx.files) {
        if (pathRe && !pathRe.test(f.path)) continue;
        const lines = f.content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i]!)) {
            hits.push(`${f.path}:${i + 1}: ${lines[i]!.slice(0, 200)}`);
            if (hits.length >= MAX_GREP_HITS) break;
          }
          re.lastIndex = 0;
        }
        if (hits.length >= MAX_GREP_HITS) break;
      }
      return {
        content:
          hits.length === 0
            ? "0 matches"
            : `${hits.length} match${hits.length === 1 ? "" : "es"}:\n${hits.join("\n")}`,
        isError: false,
      };
    }

    if (name === "report_finding") {
      // Evidence gate.
      const rel = String(input.path ?? "");
      const substr = String(input.source_contains ?? "");
      if (!rel || !substr) {
        return { content: "report_finding: path and source_contains are required", isError: true };
      }
      const abs = path.resolve(ctx.root, rel);
      if (!abs.startsWith(path.resolve(ctx.root))) {
        return { content: "path escapes target root", isError: true };
      }
      let content: string;
      try {
        content = await fs.readFile(abs, "utf8");
      } catch {
        return { content: `report_finding rejected: cannot read ${rel}`, isError: true };
      }
      if (!content.includes(substr)) {
        return {
          content: `report_finding rejected: substring not found at ${rel}. Cite an exact substring that appears in the file.`,
          isError: true,
        };
      }
      // Accepted. Return the finding as data for the loop to collect.
      const finding: AgentFinding = {
        ruleId: String(input.ruleId ?? "agent-finding"),
        title: String(input.title ?? "Untitled"),
        severity: (input.severity as AgentFinding["severity"]) ?? "medium",
        path: rel,
        line: typeof input.line === "number" ? input.line : undefined,
        fix: typeof input.fix === "string" ? input.fix : undefined,
        sourceContains: substr,
      };
      return { content: `accepted (verified in ${rel})`, isError: false, data: finding };
    }

    return { content: `unknown tool: ${name}`, isError: true };
  } catch (e) {
    return { content: `tool crash: ${e instanceof Error ? e.message : String(e)}`, isError: true };
  }
}
