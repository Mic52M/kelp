// Post-hoc reviewer — the chief that reads the squad's work and spawns
// focused follow-up agents on missed leads.
//
// One LLM call, structured output. Reads a compact view of each agent's run
// (name, steps, findings count, tail of transcript — where suspicions and
// abandoned probes usually surface) and identifies at most a handful of
// LEADS: hypotheses that were expressed but never converted into a
// confirmed report_finding (because the agent ran out of steps, got
// side-tracked, or talked itself out of it — the exact failure modes the
// last audit surfaced).
//
// For each lead the runner spawns ONE follow-up specialist with a small
// step budget, a brief scoped to the lead, and the same shared toolbox.
// The evidence gate that guards report_finding fires on the follow-up
// exactly as it does on the primary agents, so a "lead" that turns out to
// be nothing simply files nothing. Autonomy in the reasoning, zero
// fabrication in the results.

import type { LlmAgentDriver, ToolCall } from "./loop.js";
import { runAgent } from "./loop.js";
import type { SpecialistOutcome } from "./orchestrator.js";
import type { PentestTools } from "./autonomous.js";
import type { Specialist, SpecialistExecutor, SpecialistContext } from "./specialist.js";
import { AUTONOMOUS_TOOLS, type AutonomousFinding } from "./autonomous.js";

/** One lead the reviewer wants a follow-up agent to chase. */
export interface Lead {
  /** stable id used for deduplication + reporting */
  id: string;
  /** which primary agent's run this came from — for the audit trail */
  fromAgent: string;
  /** transcript step (0-indexed) where the lead surfaced */
  step: number;
  /** what the primary agent suspected but didn't confirm */
  hypothesis: string;
  /** which surface the follow-up should focus on */
  surface: "postgrest" | "edge" | "auth" | "source" | "config";
  /** which endpoint / table / function to focus on */
  target: string;
  /** why the primary didn't file a report (out of budget, misread response, …) */
  whyMissed: string;
}

/** What the runner records for each follow-up it dispatched. */
export interface FollowupOutcome {
  lead: Lead;
  outcome: SpecialistOutcome;
}

// ─── Compact "what to review" input ──────────────────────────────────────────

/** How many trailing transcript steps we hand to the reviewer per agent. The
 *  interesting "let me check X" / "found Y" / "budget exhausted" turns are
 *  overwhelmingly in the tail. Reduces reviewer input tokens ~4×. */
const TAIL_STEPS = 10;
const MAX_STEP_CHARS = 1500;

function compactOutcomes(outcomes: readonly SpecialistOutcome[]): string {
  const parts: string[] = [];
  for (const o of outcomes) {
    const t = o.transcript.slice(-TAIL_STEPS).map((s, i) => {
      const idx = Math.max(0, o.transcript.length - TAIL_STEPS) + i;
      const body = s.length > MAX_STEP_CHARS ? s.slice(0, MAX_STEP_CHARS) + "…" : s;
      return `[step ${idx}] ${body}`;
    });
    parts.push(
      `## ${o.name} (${o.vulnClass}) — ${o.steps} steps, ${o.findings.length} confirmed findings${
        o.error ? `, ERROR: ${o.error}` : ""
      }`,
      "",
      t.length ? t.join("\n\n") : "(no narration)",
      "",
    );
  }
  return parts.join("\n");
}

// ─── Reviewer LLM call ───────────────────────────────────────────────────────

const REVIEWER_SYSTEM =
  "You are Kelp's post-hoc reviewer, reading what an autonomous pen-test " +
  "squad just did against a real customer project. Your job — and ONLY your " +
  "job — is to spot LEADS the squad expressed but did not turn into a " +
  "confirmed finding:\n" +
  "  · they said 'let me verify' / 'suspicious' / 'interesting' and moved on\n" +
  "  · they ran out of step budget mid-probe (the tail of their transcript " +
  "was still hypothesising)\n" +
  "  · they misread an HTTP status (204 = success vs schema-cache error) and " +
  "wrongly concluded either a vulnerability or safety\n" +
  "  · they talked themselves out of a real signal (e.g. 'that uuid must be " +
  "redacted' when in fact Kelp never redacts short scalar ids)\n\n" +
  "You are NOT trying to find every issue yourself. You are triaging: pick " +
  "at most 3 leads that are the most likely to convert into confirmed " +
  "findings with one short focused probe run. If there is nothing worth " +
  "chasing, call `conclude` with an empty list — that is the correct answer " +
  "on a healthy project. Never invent a lead the transcript doesn't already " +
  "hint at.";

const REVIEWER_TOOLS = [
  {
    name: "spawn_followup",
    description:
      "Queue one focused follow-up agent to confirm or refute a single lead. " +
      "Cite the exact transcript step where the lead surfaced.",
    inputSchema: {
      type: "object",
      properties: {
        fromAgent: { type: "string", description: "agent name whose transcript raised it" },
        step: { type: "integer", description: "0-based step index in that transcript" },
        hypothesis: {
          type: "string",
          description: "one sentence: what specifically should be true if the vuln is real",
        },
        surface: {
          type: "string",
          enum: ["postgrest", "edge", "auth", "source", "config"],
        },
        target: {
          type: "string",
          description: "table / function / edge endpoint / config path the follow-up should focus on",
        },
        whyMissed: {
          type: "string",
          description:
            "one sentence: why the primary agent didn't file it — 'ran out of steps', 'misread 204', etc.",
        },
      },
      required: ["fromAgent", "step", "hypothesis", "surface", "target", "whyMissed"],
      additionalProperties: false,
    },
  },
  {
    name: "conclude",
    description: "Call when you've queued every worthwhile lead (max 3). Pass an empty summary if you found nothing.",
    inputSchema: {
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
      additionalProperties: false,
    },
  },
] as const;

const MAX_LEADS = 3;

/**
 * Run the reviewer LLM on the squad's outcomes. Returns the leads it queued.
 * Never throws — a reviewer failure returns an empty list so the caller
 * degrades gracefully to the primary-only report.
 */
export async function reviewCampaign(
  driver: LlmAgentDriver,
  outcomes: readonly SpecialistOutcome[],
): Promise<Lead[]> {
  const compact = compactOutcomes(outcomes);
  const leads: Lead[] = [];
  const seen = new Set<string>();

  try {
    let step = await driver.start({
      system: REVIEWER_SYSTEM,
      tools: [...REVIEWER_TOOLS],
      prompt:
        `Squad results below. Pick up to ${MAX_LEADS} leads a focused follow-up ` +
        `run should chase. Call spawn_followup for each, then conclude.\n\n${compact}`,
    });
    let n = 0;
    while (n < 4) {
      // Executor: parse tool calls, no side effects (this is a queue, not a runner).
      const results = step.toolCalls.map((call) => processReviewerCall(call, leads, seen));
      if (step.done || step.toolCalls.length === 0) break;
      n++;
      step = await driver.provideToolResults(results);
    }
  } catch {
    return [];
  }
  return leads.slice(0, MAX_LEADS);
}

function processReviewerCall(
  call: ToolCall,
  leads: Lead[],
  seen: Set<string>,
): { toolCallId: string; content: string; isError?: boolean } {
  if (call.name === "conclude") {
    return { toolCallId: call.id, content: "review complete" };
  }
  if (call.name !== "spawn_followup") {
    return { toolCallId: call.id, isError: true, content: `unknown tool ${call.name}` };
  }
  const i = call.input as Record<string, unknown>;
  const fromAgent = String(i.fromAgent ?? "").trim();
  const step = Number(i.step ?? -1);
  const hypothesis = String(i.hypothesis ?? "").trim();
  const surface = String(i.surface ?? "").trim();
  const target = String(i.target ?? "").trim();
  const whyMissed = String(i.whyMissed ?? "").trim();
  if (!fromAgent || !hypothesis || !target || !surface) {
    return { toolCallId: call.id, isError: true, content: "missing required fields" };
  }
  if (leads.length >= MAX_LEADS) {
    return { toolCallId: call.id, isError: true, content: "lead cap reached — call conclude" };
  }
  const dedupe = `${surface}|${target}|${hypothesis.slice(0, 80)}`;
  if (seen.has(dedupe)) {
    return { toolCallId: call.id, isError: true, content: "duplicate lead — pick a different one or conclude" };
  }
  seen.add(dedupe);
  leads.push({
    id: `lead-${leads.length + 1}`,
    fromAgent, step: Number.isFinite(step) && step >= 0 ? step : 0,
    hypothesis, surface: surface as Lead["surface"], target, whyMissed,
  });
  return { toolCallId: call.id, content: `queued as ${leads[leads.length - 1]!.id}` };
}

// ─── Follow-up specialist ────────────────────────────────────────────────────

/**
 * Build the follow-up specialist for one lead. Reuses the full autonomous
 * toolbox and executor — same evidence-gate invariant — but the prompt is
 * scoped tightly to the lead and the step budget is small.
 */
export function createFollowupSpecialist(
  lead: Lead,
): Specialist<PentestTools, AutonomousFinding> {
  return {
    name: `followup:${lead.id}`,
    vulnClass: guessVulnClass(lead.surface),
    systemPrompt:
      "You are a focused follow-up run inside Kelp's autonomous pen test. " +
      "The primary squad flagged ONE specific lead they didn't confirm. Your " +
      "entire job is to confirm or refute it with 2–3 probes and file a " +
      "finding IF AND ONLY IF the observable proves the vuln. Do not " +
      "explore anywhere else. If the lead was a misread (common failure " +
      "modes: 204 was a PostgREST error, not a success; a foreign uuid was " +
      "in fact your own; the endpoint is locked by RLS you didn't see) — " +
      "call conclude with no finding. Same rules as the primary squad: no " +
      "language like 'VULNERABILITY FOUND' before report_finding succeeds; " +
      "short scalar identifiers pass through un-redacted.",
    tools: AUTONOMOUS_TOOLS,
    initialPrompt() {
      return (
        `LEAD (from ${lead.fromAgent} step ${lead.step}): ${lead.hypothesis}\n` +
        `Focus surface: ${lead.surface} · target: ${lead.target}\n` +
        `Why the primary missed it: ${lead.whyMissed}\n\n` +
        `Run 2–3 focused probes to confirm or refute. Then conclude.`
      );
    },
    createExecutor(tools: PentestTools, ctx: SpecialistContext): SpecialistExecutor<AutonomousFinding> {
      // Delayed import to avoid a circular reference at module init.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createAutonomousPentester } = require("./autonomous.js") as typeof import("./autonomous.js");
      // We reuse the full autonomous specialist just for its executor — the
      // system prompt above already overrides scope + tone, so the persona
      // wrapping is fine to reuse.
      const inner = createAutonomousPentester(
        { name: "followup-inner", vulnClass: this.vulnClass, mission: lead.hypothesis },
      );
      return inner.createExecutor(tools, ctx);
    },
  };
}

function guessVulnClass(surface: Lead["surface"]) {
  switch (surface) {
    case "postgrest": return "rls" as const;
    case "edge":      return "auth" as const;
    case "auth":      return "auth" as const;
    case "config":    return "exposure" as const;
    case "source":    return "secret" as const;
  }
}

/**
 * Convenience: run one follow-up specialist directly (bypassing the campaign
 * orchestrator for this single-step slice). The caller merges the outcome
 * into the top-level report.
 */
export async function runFollowup(
  lead: Lead,
  tools: PentestTools,
  driver: LlmAgentDriver,
  ctx: SpecialistContext,
  maxSteps = 8,
): Promise<SpecialistOutcome> {
  const specialist = createFollowupSpecialist(lead);
  try {
    const executor = specialist.createExecutor(tools, ctx);
    const { transcript, steps } = await runAgent(driver, executor, {
      system: specialist.systemPrompt,
      tools: specialist.tools,
      prompt: specialist.initialPrompt(ctx),
      maxSteps,
    });
    const usage = driver.getUsage ? driver.getUsage() : null;
    return {
      name: specialist.name,
      vulnClass: specialist.vulnClass,
      findings: [...executor.findings],
      transcript,
      error: null,
      steps,
      usage: usage
        ? {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            // Cost is folded into totalUsage in the campaign wrapper.
            estimatedCostUsd: 0,
          }
        : null,
    };
  } catch (e) {
    return {
      name: specialist.name,
      vulnClass: specialist.vulnClass,
      findings: [],
      transcript: [],
      error: e instanceof Error ? e.message : String(e),
      steps: 0,
      usage: null,
    };
  }
}
