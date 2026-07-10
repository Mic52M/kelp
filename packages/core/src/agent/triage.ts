// Post-review triage — one LLM pass that reads confirmed findings with
// skeptical eyes and can DOWNGRADE, RECLASSIFY, or REJECT them before they
// ship to the user. Never adds a new finding, never raises severity.
//
// Motivating incident (usatopoint-test, 2026-07-08): the reviewer's follow-up
// filed a real RLS finding (permissive newsletter INSERT policy) but tagged
// it `secret / high`. The evidence gate correctly guarded the finding's
// existence — but nothing was guarding its *class + severity*. This layer
// does that job structurally, so no future user has to reason about a
// mislabelled real finding.
//
// Invariants (enforced in code, not the prompt):
//   1. Never fabricates a new finding — only ever mutates or drops filed ones.
//   2. Cannot upgrade severity — the applier rejects any change that would.
//   3. A triage failure returns an empty decisions list (crash-isolated).
//   4. Each decision carries a one-sentence `reason` persisted alongside the
//      finding so the user sees WHY Kelp declassified.

import type { AutonomousFinding } from "./autonomous.js";
import type { AuthModelBrief } from "./auth-model.js";
import type { LlmAgentDriver, ToolCall } from "./loop.js";
import type {
  CampaignReport,
  SpecialistOutcome,
  SpecialistUsage,
} from "./orchestrator.js";
import { estimateCostUsd } from "./pricing.js";
import type { FindingStatus, Severity, VulnClass } from "../types.js";

// ─── Public shapes ───────────────────────────────────────────────────────────

export type TriageAction =
  | "keep"
  | "downgrade_to_needs_review"
  | "reclassify"
  | "reject";

/**
 * One triage decision, addressed by the (outcomeIndex, findingIndex) pair the
 * LLM saw in the input. `outcomeIndex` indexes into the campaign's outcomes;
 * `findingIndex` into that outcome's findings array.
 */
export interface TriageDecision {
  outcomeIndex: number;
  findingIndex: number;
  action: TriageAction;
  reclassifyTo?: { vulnClass?: VulnClass; severity?: Severity };
  /** one sentence — surfaced to the user with the finding */
  reason: string;
}

export interface TriageResult {
  decisions: TriageDecision[];
  usage: SpecialistUsage | null;
}

// ─── Severity ordering — for the never-upgrade invariant ─────────────────────

const SEV_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function isDowngradeOrSame(from: Severity, to: Severity): boolean {
  return SEV_RANK[to] >= SEV_RANK[from];
}

// ─── Compact input the LLM sees ──────────────────────────────────────────────

interface FindingRef {
  outcomeIndex: number;
  findingIndex: number;
  outcomeName: string;
  finding: AutonomousFinding;
}

function collectFindings(outcomes: readonly SpecialistOutcome[]): FindingRef[] {
  const refs: FindingRef[] = [];
  outcomes.forEach((o, oi) => {
    o.findings.forEach((f, fi) => {
      refs.push({
        outcomeIndex: oi,
        findingIndex: fi,
        outcomeName: o.name,
        finding: f as AutonomousFinding,
      });
    });
  });
  return refs;
}

const MAX_EVIDENCE_CHARS = 700;

function compactRefs(refs: readonly FindingRef[]): string {
  return refs
    .map((r, i) => {
      const f = r.finding;
      const ev = f.evidence.length > MAX_EVIDENCE_CHARS
        ? f.evidence.slice(0, MAX_EVIDENCE_CHARS) + "…"
        : f.evidence;
      return (
        `[${i}] agent=${r.outcomeName} · vulnClass=${f.vulnClass} · ` +
        `severity=${f.severity} · surface=${f.surface} · endpoint=${f.endpoint}\n` +
        `    title:    ${f.title}\n` +
        `    evidence: ${ev}`
      );
    })
    .join("\n\n");
}

// ─── LLM contract ────────────────────────────────────────────────────────────

const TRIAGE_SYSTEM =
  "You are Kelp's post-review triage. The autonomous pen-test squad + the " +
  "reviewer just filed a set of findings. Every finding here already passed " +
  "the evidence gate — the observable it claims IS reproducible. That is NOT " +
  "your job to re-verify.\n\n" +
  "Your ONE job is to catch mislabelling and impact inflation before the user " +
  "sees the report. For each finding, decide:\n" +
  "  · KEEP — vulnClass + severity match the evidence, impact claim is real.\n" +
  "  · DOWNGRADE_TO_NEEDS_REVIEW — the observable holds but impact is " +
  "questionable, exploitability needs implausible pre-conditions, or severity " +
  "looks inflated for what the evidence actually proves.\n" +
  "  · RECLASSIFY — the vulnClass is wrong for the *nature* of the bug " +
  "(e.g. permissive RLS policy filed as 'secret'; hardcoded key filed as " +
  "'rls'). Optionally lower the severity in the same call. You MAY NOT raise " +
  "severity — Kelp never adds noise.\n" +
  "  · REJECT — the observable is technically reproducible but the impact " +
  "claim is nonsense: unfalsifiable, definitional, or dominated by obvious " +
  "mitigations already in place.\n\n" +
  "You have NO tools to probe or investigate. Reason strictly from the " +
  "evidence text you're shown AND the AUTH MODEL block at the top of your " +
  "system prompt (if present) — those facts about ambient authority, " +
  "cookies, Allow-Credentials, price recalc, and one-time-token flows are " +
  "GROUND TRUTH about this app, do NOT question them.\n\n" +
  "APPLY THESE RULES STRICTLY (they duplicate the runtime gate the agent " +
  "already ran through — findings that landed here anyway are the ambiguous " +
  "cases where your judgment matters):\n" +
  " · 'CSRF' finding on a bearer-JWT / no-Allow-Credentials app → REJECT. " +
  "There is no ambient authority; browsers do not send the Bearer token " +
  "cross-origin. Even if the endpoint has 'no CSRF token', the vector " +
  "doesn't exist.\n" +
  " · 'Permissive/wildcard CORS' at medium+ severity, when the auth model " +
  "says NO Allow-Credentials AND the evidence doesn't name a specific " +
  "sensitive body value → DOWNGRADE to low, or REJECT if the finding is " +
  "cosmetic. Wildcard CORS on a public API without credentials leaks " +
  "nothing the browser doesn't already permit.\n" +
  " · 'Anonymous INSERT' finding where the evidence doesn't name concrete " +
  "downstream harm (spam email dispatched, row publicly readable, webhook " +
  "triggered, enumeration primitive) → REJECT. A public form legitimately " +
  "needs anon INSERT.\n" +
  " · 'verify_jwt=false' finding on a function whose evidence shows it does " +
  "its own auth check (JWT parse + validation, API key check, one-time " +
  "token verification) → REJECT. The config disable is intentional; the " +
  "function is not unauthed.\n" +
  " · Severity mismatch (evidence describes hardening but severity is " +
  "medium+, or evidence describes real data leak but severity is low) → " +
  "RECLASSIFY to match the actual impact.\n\n" +
  "When in doubt on a case the rules above don't cover, KEEP — it is " +
  "better to ship a borderline true positive than to reject a real bug. " +
  "Never upgrade severity. Never propose a new finding. Provide ONE " +
  "sentence of reasoning per decision — it will be shown verbatim to the " +
  "user, so make it concrete (name the fact from the auth model that " +
  "settled the call).";

const TRIAGE_TOOLS = [
  {
    name: "record_decision",
    description:
      "Record your triage verdict for one finding. Call once per finding you " +
      "want to touch — leave a finding untouched to KEEP it implicitly, or " +
      "call with action='keep' to be explicit.",
    inputSchema: {
      type: "object",
      properties: {
        index: { type: "integer", description: "the [N] index shown in the input" },
        action: {
          type: "string",
          enum: ["keep", "downgrade_to_needs_review", "reclassify", "reject"],
        },
        reclassifyVulnClass: {
          type: "string",
          enum: ["rls", "secret", "bola", "auth", "injection", "ssrf", "exposure"],
          description: "only for action='reclassify'",
        },
        reclassifySeverity: {
          type: "string",
          enum: ["critical", "high", "medium", "low"],
          description: "only for action='reclassify' — MUST be equal or lower",
        },
        reason: {
          type: "string",
          description: "one sentence, shown to the user",
        },
      },
      required: ["index", "action", "reason"],
      additionalProperties: false,
    },
  },
  {
    name: "conclude",
    description: "Call when every finding has been considered.",
    inputSchema: {
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
      additionalProperties: false,
    },
  },
] as const;

// ─── Runner ──────────────────────────────────────────────────────────────────

const MAX_STEPS = 4;

/**
 * Run the triage LLM against the confirmed findings in `outcomes`. Returns
 * structured decisions the caller applies via `applyTriage`. Never throws —
 * a driver failure returns `{ decisions: [], usage: null }` so the caller
 * degrades to the untouched primary+reviewer report.
 */
export async function triageCampaign(
  driver: LlmAgentDriver,
  outcomes: readonly SpecialistOutcome[],
  authModel?: AuthModelBrief,
): Promise<TriageResult> {
  const refs = collectFindings(outcomes);
  if (refs.length === 0) return { decisions: [], usage: null };

  const decisions: TriageDecision[] = [];
  const seen = new Set<number>();
  const authHeader = authModel ? `${authModel.narrative}\n\n` : "";

  try {
    let step = await driver.start({
      system: `${authHeader}${TRIAGE_SYSTEM}`,
      tools: [...TRIAGE_TOOLS],
      prompt:
        `${refs.length} confirmed finding(s) to triage. Call ` +
        `record_decision for each one you want to downgrade / reclassify / ` +
        `reject (or keep, explicitly), then conclude.\n\n${compactRefs(refs)}`,
    });
    let n = 0;
    while (n < MAX_STEPS) {
      const results = step.toolCalls.map((call) =>
        processTriageCall(call, refs, decisions, seen),
      );
      if (step.done || step.toolCalls.length === 0) break;
      n++;
      step = await driver.provideToolResults(results);
    }
  } catch {
    return { decisions: [], usage: null };
  }

  const usage = driver.getUsage ? driver.getUsage() : null;
  return {
    decisions,
    usage: usage
      ? {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          estimatedCostUsd: estimateCostUsd(usage),
        }
      : null,
  };
}

function processTriageCall(
  call: ToolCall,
  refs: readonly FindingRef[],
  decisions: TriageDecision[],
  seen: Set<number>,
): { toolCallId: string; content: string; isError?: boolean } {
  if (call.name === "conclude") {
    return { toolCallId: call.id, content: "triage complete" };
  }
  if (call.name !== "record_decision") {
    return { toolCallId: call.id, isError: true, content: `unknown tool ${call.name}` };
  }
  const i = call.input as Record<string, unknown>;
  const index = Number(i.index ?? -1);
  const action = String(i.action ?? "") as TriageAction;
  const reason = String(i.reason ?? "").trim();

  if (!Number.isInteger(index) || index < 0 || index >= refs.length) {
    return { toolCallId: call.id, isError: true, content: `bad index ${index}` };
  }
  if (seen.has(index)) {
    return { toolCallId: call.id, isError: true, content: `duplicate decision for [${index}]` };
  }
  if (!reason) {
    return { toolCallId: call.id, isError: true, content: "reason is required" };
  }
  if (
    action !== "keep" &&
    action !== "downgrade_to_needs_review" &&
    action !== "reclassify" &&
    action !== "reject"
  ) {
    return { toolCallId: call.id, isError: true, content: `bad action ${action}` };
  }

  const ref = refs[index]!;
  const reclassifyTo: TriageDecision["reclassifyTo"] = {};
  if (action === "reclassify") {
    const vc = i.reclassifyVulnClass ? String(i.reclassifyVulnClass) : undefined;
    const sv = i.reclassifySeverity ? String(i.reclassifySeverity) : undefined;
    if (!vc && !sv) {
      return {
        toolCallId: call.id,
        isError: true,
        content: "reclassify requires reclassifyVulnClass and/or reclassifySeverity",
      };
    }
    if (vc) reclassifyTo.vulnClass = vc as VulnClass;
    if (sv) {
      const nextSev = sv as Severity;
      if (!isDowngradeOrSame(ref.finding.severity, nextSev)) {
        return {
          toolCallId: call.id,
          isError: true,
          content:
            `severity upgrade refused: ${ref.finding.severity} → ${nextSev}. ` +
            `Triage may only downgrade.`,
        };
      }
      reclassifyTo.severity = nextSev;
    }
  }

  seen.add(index);
  decisions.push({
    outcomeIndex: ref.outcomeIndex,
    findingIndex: ref.findingIndex,
    action,
    reason,
    ...(action === "reclassify" ? { reclassifyTo } : {}),
  });
  return { toolCallId: call.id, content: `recorded [${index}] as ${action}` };
}

// ─── Applier ────────────────────────────────────────────────────────────────

/** Extra fields the applier stamps onto each finding it touched. */
export interface TriageAnnotation {
  action: Exclude<TriageAction, "reject">;
  reason: string;
  /** null when the action is a plain 'keep' — no status override needed. */
  initialStatus: FindingStatus | null;
  /** the original (pre-triage) severity + vulnClass, for audit + UI diffing. */
  originalVulnClass?: VulnClass;
  originalSeverity?: Severity;
}

/** A finding after the applier stamped its triage annotation onto it. */
export type TriagedFinding = AutonomousFinding & { triage?: TriageAnnotation };

const TRIAGE_EVIDENCE_PREFIX = "Kelp triage: ";

/**
 * Fold triage decisions into a new CampaignReport. Rejected findings are
 * dropped; downgraded/reclassified findings are mutated in place on a fresh
 * copy and stamped with a `triage` field so downstream can pick up the
 * initial status + reason. Never upgrades severity (defence in depth — the
 * runner already refuses; this second check makes the invariant a property
 * of the applier too).
 */
export function applyTriage(
  report: CampaignReport,
  decisions: readonly TriageDecision[],
): CampaignReport {
  // Group decisions by outcome for O(1) lookup.
  const byOutcome = new Map<number, Map<number, TriageDecision>>();
  for (const d of decisions) {
    let m = byOutcome.get(d.outcomeIndex);
    if (!m) {
      m = new Map();
      byOutcome.set(d.outcomeIndex, m);
    }
    m.set(d.findingIndex, d);
  }

  const outcomes: SpecialistOutcome[] = report.outcomes.map((o, oi) => {
    const perFinding = byOutcome.get(oi);
    if (!perFinding || perFinding.size === 0) return o;

    const nextFindings: unknown[] = [];
    o.findings.forEach((raw, fi) => {
      const d = perFinding.get(fi);
      if (!d) {
        nextFindings.push(raw);
        return;
      }
      if (d.action === "reject") return; // dropped

      const f = raw as AutonomousFinding;
      const originalVulnClass = f.vulnClass;
      const originalSeverity = f.severity;
      let vulnClass = f.vulnClass;
      let severity = f.severity;
      let initialStatus: FindingStatus | null = null;

      if (d.action === "reclassify") {
        if (d.reclassifyTo?.vulnClass) vulnClass = d.reclassifyTo.vulnClass;
        if (
          d.reclassifyTo?.severity &&
          isDowngradeOrSame(f.severity, d.reclassifyTo.severity)
        ) {
          severity = d.reclassifyTo.severity;
        }
      } else if (d.action === "downgrade_to_needs_review") {
        initialStatus = "needs_review";
      }

      const evidence =
        d.action === "keep"
          ? f.evidence
          : `${f.evidence}\n\n${TRIAGE_EVIDENCE_PREFIX}${d.reason}`;

      const triage: TriageAnnotation = {
        action: d.action,
        reason: d.reason,
        initialStatus,
      };
      if (originalVulnClass !== vulnClass) triage.originalVulnClass = originalVulnClass;
      if (originalSeverity !== severity) triage.originalSeverity = originalSeverity;
      const annotated: TriagedFinding = {
        ...f,
        vulnClass,
        severity,
        evidence,
        triage,
      };
      nextFindings.push(annotated);
    });

    return { ...o, findings: nextFindings };
  });

  const findings: unknown[] = outcomes.flatMap((o) => o.findings);
  return { outcomes, findings, totalUsage: report.totalUsage };
}

/** Human-readable rollup for logs. */
export function summarizeTriage(decisions: readonly TriageDecision[]): string {
  const counts = { keep: 0, downgrade: 0, reclassify: 0, reject: 0 };
  for (const d of decisions) {
    if (d.action === "keep") counts.keep++;
    else if (d.action === "downgrade_to_needs_review") counts.downgrade++;
    else if (d.action === "reclassify") counts.reclassify++;
    else if (d.action === "reject") counts.reject++;
  }
  return (
    `triage: ${counts.keep} kept, ${counts.downgrade} downgraded, ` +
    `${counts.reclassify} reclassified, ${counts.reject} rejected`
  );
}
