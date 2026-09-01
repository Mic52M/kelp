// Types the agent loop passes around. Kept local to the CLI so we can
// evolve the agent output without churn on the shared @kelp/core surface.

import type { Severity } from "@kelp/core";

export interface AgentFinding {
  ruleId: string;
  title: string;
  severity: Severity;
  path: string;
  line?: number;
  /** what the agent thinks the fix is (short) */
  fix?: string;
  /** the substring at `path` that proves the finding is real */
  sourceContains: string;
}

export interface Cost {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  usdCents: number;
}

/** A single agent event — every one is printed as a timestamped line. */
export type AgentEvent =
  | { kind: "thinking"; text: string }
  | { kind: "tool_call"; name: string; input: Record<string, unknown> }
  | { kind: "tool_result"; name: string; summary: string; isError: boolean }
  | { kind: "finding"; finding: AgentFinding; verified: boolean; reason?: string }
  | { kind: "cost"; costUsdCents: number; tokensIn: number; tokensOut: number }
  | { kind: "done"; findings: AgentFinding[]; cost: Cost; iterations: number }
  | { kind: "aborted"; reason: string; cost: Cost };
