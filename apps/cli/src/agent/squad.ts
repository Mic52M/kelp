// Multi-specialist agent squad for `kelp scan --agent --squad`.
//
// The single-loop --agent tries to cover every vuln class in one context
// window: secrets, RLS, edge functions, auth-on-routes, redirects. Real
// runs on real repos show the model losing focus as the tool_result blob
// grows: it opens a big file to check RLS, spends the rest of its budget
// there, and never gets to auth-routes. This module fixes that by running
// N focused specialists in parallel, each with its own conversation, its
// own iteration budget, its own prompt. A final reviewer pass dedups the
// aggregated findings and re-verifies each one against the source before
// returning.
//
// Two invariants are preserved from the single-loop path:
//
//   1. Evidence gate. Every finding a specialist files is already gated
//      by tools.ts (`report_finding` requires a source_contains that the
//      executor verifies against the cited file). The reviewer runs a
//      second pass over the same substring on the same file bytes, so a
//      specialist that hallucinates a location is filtered out even if
//      the executor's initial check missed it (e.g. because the file was
//      edited between the tool call and the report_finding, though that
//      cannot happen within a single scan).
//
//   2. Hard cost cap. Each specialist gets its own maxCostCents slice
//      of the overall budget. If a specialist exhausts its slice the
//      others keep going. The reviewer gets a small fixed slice on top.
//
// Not a full multi-agent framework: no inter-specialist messaging, no
// dynamic budgets, no re-planning. That is deliberate. The value here is
// focus, not orchestration complexity.

import fs from "node:fs/promises";
import path from "node:path";
import type { SourceFile } from "@kelp/core";
import { runAgent, type DriverFactory } from "./loop.js";
import type { AgentEvent, AgentFinding, Cost } from "./types.js";

// ── Public interface ─────────────────────────────────────────────────

/** One specialist in the squad. `share` is a slice of the total budget
 *  (0 to 1). All shares must sum to <= 1 (the remainder is reserved for
 *  the reviewer). */
export interface SpecialistSpec {
  id: string;
  title: string;
  systemPrompt: string;
  userPrompt: string;
  share: number;
  maxIterations?: number;
}

export interface SquadRunInput {
  apiKey: string;
  model: string;
  target: string;
  root: string;
  files: readonly SourceFile[];
  /** Total budget for the whole squad in USD cents. Split across specialists
   *  by `share`, with a reserve for the reviewer. */
  totalMaxCostCents: number;
  /** Iteration cap default per specialist, if not overridden. */
  maxIterationsPerSpecialist?: number;
  specialists: readonly SpecialistSpec[];
  onEvent: (e: SquadEvent) => void;
  /** Driver factory. Inject for tests; defaults to the real Anthropic
   *  driver when omitted. */
  driverFactory?: DriverFactory;
}

/** Wraps AgentEvent with a `specialist` field so the renderer knows which
 *  parallel stream produced the event. */
export type SquadEvent =
  | { kind: "specialist_started"; specialist: string; title: string }
  | { kind: "specialist_finished"; specialist: string; findings: number; cost: Cost; aborted?: string }
  | { kind: "reviewer_started" }
  | { kind: "reviewer_verdict"; kept: number; dropped: number }
  | ({ specialist: string } & AgentEvent);

export interface SpecialistOutcome {
  id: string;
  title: string;
  findings: AgentFinding[];
  cost: Cost;
  iterations: number;
  aborted?: string;
  coverage: { filesRead: number; grepsRun: number; listsRun: number };
}

export interface SquadResult {
  /** Findings after dedup + reviewer verification. This is what the caller
   *  usually renders. */
  findings: AgentFinding[];
  /** Findings the reviewer dropped, with the reason. Kept for the
   *  transcript so users can see what the squad initially thought vs
   *  what survived verification. */
  dropped: { finding: AgentFinding; reason: string }[];
  perSpecialist: SpecialistOutcome[];
  totalCost: Cost;
  totalIterations: number;
}

// ── Squad orchestrator ───────────────────────────────────────────────

/** Run every specialist in parallel, then run the reviewer over the
 *  merged findings. Never throws for individual-specialist failures:
 *  they surface as `aborted` in that specialist's outcome, and the rest
 *  keeps going. */
export async function runAgentSquad(input: SquadRunInput): Promise<SquadResult> {
  // Reserve 10% of the total for the reviewer, cap at $0.10. This is
  // enough for the reviewer to read each finding's file once and verify
  // the substring; it never generates content, only accepts/rejects.
  const reviewerReserve = Math.min(Math.round(input.totalMaxCostCents * 0.1), 10);
  const specialistBudget = Math.max(0, input.totalMaxCostCents - reviewerReserve);

  // Split the specialist budget by declared share. `share` sums are not
  // required to equal 1 — we normalize so the caller can pass any weights.
  const totalShare = input.specialists.reduce((s, sp) => s + sp.share, 0) || 1;

  const runs = input.specialists.map(async (sp) => {
    const budget = Math.max(1, Math.round((specialistBudget * sp.share) / totalShare));
    input.onEvent({ kind: "specialist_started", specialist: sp.id, title: sp.title });

    const res = await runAgent({
      apiKey: input.apiKey,
      model: input.model,
      target: input.target,
      root: input.root,
      files: input.files,
      maxIterations: sp.maxIterations ?? input.maxIterationsPerSpecialist ?? 12,
      maxCostCents: budget,
      systemPrompt: sp.systemPrompt,
      userPrompt: sp.userPrompt,
      driverFactory: input.driverFactory,
      onEvent: (e) => input.onEvent({ ...(e as AgentEvent), specialist: sp.id }),
    }).catch((err) => {
      // A specialist that crashes shouldn't take the whole squad down.
      // Return an empty result with an aborted reason.
      const reason = err instanceof Error ? err.message : String(err);
      return {
        findings: [] as AgentFinding[],
        cost: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          usdCents: 0,
        } as Cost,
        iterations: 0,
        aborted: `specialist-error: ${reason}`,
        coverage: { filesRead: 0, grepsRun: 0, listsRun: 0 },
      };
    });

    input.onEvent({
      kind: "specialist_finished",
      specialist: sp.id,
      findings: res.findings.length,
      cost: res.cost,
      aborted: res.aborted,
    });

    const outcome: SpecialistOutcome = {
      id: sp.id,
      title: sp.title,
      findings: res.findings,
      cost: res.cost,
      iterations: res.iterations,
      aborted: res.aborted,
      coverage: res.coverage,
    };
    return outcome;
  });

  const perSpecialist = await Promise.all(runs);

  // Aggregate raw findings. Dedup by (ruleId, path, line): specialists
  // often report the same secret twice from different angles.
  const merged = new Map<string, AgentFinding>();
  for (const out of perSpecialist) {
    for (const f of out.findings) {
      const key = `${f.ruleId}::${f.path}::${f.line ?? 0}`;
      if (!merged.has(key)) merged.set(key, f);
    }
  }
  const preReview = [...merged.values()];

  // Reviewer stage. Re-reads each finding's file and verifies the
  // source_contains substring still holds. This catches cases where a
  // specialist synthesized a plausible finding shape but the substring
  // isn't in the file. Local, cheap, no LLM call.
  input.onEvent({ kind: "reviewer_started" });
  const { kept, dropped } = await reviewFindings(input.root, preReview);
  input.onEvent({ kind: "reviewer_verdict", kept: kept.length, dropped: dropped.length });

  const totalCost = sumCosts(perSpecialist.map((o) => o.cost));
  const totalIterations = perSpecialist.reduce((s, o) => s + o.iterations, 0);

  return {
    findings: kept,
    dropped,
    perSpecialist,
    totalCost,
    totalIterations,
  };
}

// ── Reviewer (local, deterministic) ──────────────────────────────────

async function reviewFindings(
  root: string,
  findings: readonly AgentFinding[],
): Promise<{ kept: AgentFinding[]; dropped: { finding: AgentFinding; reason: string }[] }> {
  const kept: AgentFinding[] = [];
  const dropped: { finding: AgentFinding; reason: string }[] = [];

  // Cache file reads: multiple findings often point at the same file.
  const cache = new Map<string, string | null>();
  async function readOnce(rel: string): Promise<string | null> {
    if (cache.has(rel)) return cache.get(rel)!;
    try {
      const abs = path.resolve(root, rel);
      // Reject path escapes. The reviewer never reads outside the target.
      const rooted = path.resolve(root);
      if (!abs.startsWith(rooted + path.sep) && abs !== rooted) {
        cache.set(rel, null);
        return null;
      }
      const content = await fs.readFile(abs, "utf8");
      cache.set(rel, content);
      return content;
    } catch {
      cache.set(rel, null);
      return null;
    }
  }

  for (const f of findings) {
    if (!f.sourceContains || f.sourceContains.length === 0) {
      dropped.push({ finding: f, reason: "reviewer: finding had no source_contains substring" });
      continue;
    }
    const content = await readOnce(f.path);
    if (content === null) {
      dropped.push({ finding: f, reason: "reviewer: cited file could not be read" });
      continue;
    }
    if (!content.includes(f.sourceContains)) {
      dropped.push({
        finding: f,
        reason: "reviewer: source_contains substring is not in the cited file",
      });
      continue;
    }
    kept.push(f);
  }
  return { kept, dropped };
}

// ── Helpers ──────────────────────────────────────────────────────────

function sumCosts(costs: readonly Cost[]): Cost {
  return costs.reduce<Cost>(
    (acc, c) => ({
      inputTokens: acc.inputTokens + c.inputTokens,
      outputTokens: acc.outputTokens + c.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + c.cacheReadTokens,
      cacheWriteTokens: acc.cacheWriteTokens + c.cacheWriteTokens,
      usdCents: acc.usdCents + c.usdCents,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, usdCents: 0 },
  );
}
