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
import type { AuthModelBrief } from "./auth-model.js";
import type { Specialist, SpecialistExecutor, SpecialistContext } from "./specialist.js";
import {
  AUTONOMOUS_TOOLS,
  createAutonomousPentester,
  type AutonomousFinding,
} from "./autonomous.js";

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

/**
 * We hand the reviewer BOTH the head and the tail of each agent's transcript.
 *
 * - Head (first HEAD_STEPS): where agents enumerate hypotheses and often
 *   commit their first "this looks suspicious but let me move on" — the
 *   *early-abandonment* pattern. usatopoint 2026-07-09 13:37 missed the
 *   newsletter_subscribers finding because agent-data expressed the
 *   observation at step 4/28 and the reviewer only saw the tail.
 * - Tail (last TAIL_STEPS): where budget-exhausted probes and
 *   last-minute hypotheses live.
 *
 * Middle steps are dropped — they're usually elaboration of the head, and
 * dropping them keeps the reviewer's input token cost near flat.
 */
const HEAD_STEPS = 6;
const TAIL_STEPS = 12;
const MAX_STEP_CHARS = 1500;

function compactOutcomes(outcomes: readonly SpecialistOutcome[]): string {
  const parts: string[] = [];
  for (const o of outcomes) {
    parts.push(
      `## ${o.name} (${o.vulnClass}) — ${o.steps} steps, ${o.findings.length} confirmed findings${
        o.error ? `, ERROR: ${o.error}` : ""
      }`,
      "",
      renderTranscript(o.transcript) || "(no narration)",
      "",
    );
  }
  return parts.join("\n");
}

function renderTranscript(transcript: readonly string[]): string {
  const truncate = (s: string) =>
    s.length > MAX_STEP_CHARS ? s.slice(0, MAX_STEP_CHARS) + "…" : s;
  const fmt = (idx: number, s: string) => `[step ${idx}] ${truncate(s)}`;

  const n = transcript.length;
  if (n === 0) return "";
  // Small transcript → send everything, no head/tail split needed.
  if (n <= HEAD_STEPS + TAIL_STEPS) {
    return transcript.map((s, i) => fmt(i, s)).join("\n\n");
  }
  const head = transcript.slice(0, HEAD_STEPS).map((s, i) => fmt(i, s));
  const tail = transcript
    .slice(n - TAIL_STEPS)
    .map((s, i) => fmt(n - TAIL_STEPS + i, s));
  const skipped = n - HEAD_STEPS - TAIL_STEPS;
  return [
    ...head,
    `[… ${skipped} intermediate step(s) elided …]`,
    ...tail,
  ].join("\n\n");
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
  opts: { authModel?: AuthModelBrief } = {},
): Specialist<PentestTools, AutonomousFinding> {
  const authHeader = opts.authModel ? `${opts.authModel.narrative}\n\n` : "";
  return {
    name: `followup:${lead.id}`,
    vulnClass: guessVulnClass(lead.surface),
    systemPrompt:
      `${authHeader}You are a focused follow-up run inside Kelp's autonomous pen test. ` +
      "The primary squad flagged ONE specific lead they didn't confirm. Your " +
      "entire job is to confirm or refute it with focused probes and file a " +
      "finding IF AND ONLY IF the observable proves the vuln AND the impact " +
      "chain survives the auth model above. Do not explore anywhere else. " +
      "If the lead was a misread (common failure modes: 204 was a PostgREST " +
      "error, not a success; a foreign uuid was in fact your own; the " +
      "endpoint is locked by RLS you didn't see; the 'CSRF' hypothesis dies " +
      "because there's no ambient authority) — call conclude with no " +
      "finding. Same rules as the primary squad: no language like " +
      "'VULNERABILITY FOUND' before report_finding succeeds; short scalar " +
      "identifiers pass through un-redacted.\n\n" +
      "CRITICAL FILING RULE — this loop has ended in the past with real " +
      "findings LOST because the model wrote a full impact-chain narration " +
      "and then said 'Now let me report this finding:' as a standalone " +
      "message, deferring the actual report_finding tool call to a next " +
      "turn that never came. DO NOT DO THIS. The moment your evidence + " +
      "impact chain is complete, emit report_finding IN THE SAME assistant " +
      "response as the narration. Keep the narration brief — the executor " +
      "records the description you pass to report_finding, not your " +
      "chain-of-thought. Two turns to file = one turn to lose the finding.",
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
      // Reuse the autonomous specialist for its executor — the follow-up's
      // own systemPrompt already overrides scope + tone; we pass authModel
      // through so the executor picks up the exploitability gate too.
      const inner = createAutonomousPentester(
        { name: "followup-inner", vulnClass: this.vulnClass, mission: lead.hypothesis },
        opts.authModel ? { authModel: opts.authModel } : {},
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
  maxSteps = 20,
  opts: { authModel?: AuthModelBrief } = {},
): Promise<SpecialistOutcome> {
  const specialist = createFollowupSpecialist(lead, opts);
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
