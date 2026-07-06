// Claude token cost accounting (issue #25).
//
// Each specialist runs its own Claude conversation. With 5–7 specialists in a
// campaign the per-project cost can spike unpredictably — we need per-run cost
// figures so we can (a) show the user roughly what a scan cost, (b) refuse to
// launch a campaign if a projected/spent cost exceeds a per-plan cap.
//
// Prices are public Anthropic rates (USD per million tokens) as of 2026-07.
// They change — keep this list narrow and update it deliberately, don't infer
// prices from model names at runtime.
//
// This module is intentionally in @kelp/core (not the worker) so unit tests can
// exercise cost math without importing the SDK, and so a future non-Anthropic
// driver can share the same accounting.

import type { PlanTier } from "../types.js";
import type { LlmUsage } from "./loop.js";

export interface ModelRate {
  /** USD per 1,000,000 input tokens */
  inputPerMTok: number;
  /** USD per 1,000,000 output tokens */
  outputPerMTok: number;
}

/**
 * Prefix-keyed rate table: we match the longest key that a model id starts with,
 * so versioned suffixes (`claude-haiku-4-5-20251001`) resolve to the base rate
 * without every dated variant needing its own row.
 */
export const MODEL_RATES: Record<string, ModelRate> = {
  "claude-opus-4-8": { inputPerMTok: 15, outputPerMTok: 75 },
  "claude-opus-4-7": { inputPerMTok: 15, outputPerMTok: 75 },
  "claude-sonnet-5": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
};

/** Longest matching prefix, or null if we don't recognise the model. */
export function findModelRate(model: string): ModelRate | null {
  let best: string | null = null;
  for (const key of Object.keys(MODEL_RATES)) {
    if (model.startsWith(key) && (best === null || key.length > best.length)) best = key;
  }
  return best ? (MODEL_RATES[best] as ModelRate) : null;
}

/**
 * Convert token usage to a USD estimate. Returns 0 for unrecognised models —
 * the caller decides whether that's tolerable (unit tests) or a policy failure
 * (production cap check).
 */
export function estimateCostUsd(usage: LlmUsage): number {
  if (!usage.model) return 0;
  const rate = findModelRate(usage.model);
  if (!rate) return 0;
  return (
    (usage.inputTokens / 1_000_000) * rate.inputPerMTok +
    (usage.outputTokens / 1_000_000) * rate.outputPerMTok
  );
}

/** USD → integer cents, rounded (never floored to 0 for tiny positive spends). */
export function costUsdToCents(usd: number): number {
  return Math.round(usd * 100);
}

// ─── Per-plan monthly spend caps ─────────────────────────────────────────────
// The free tier is already limited by scan count (see #17); active pen-testing
// is a paid-only feature, so free gets 0 cap. Caps are conservative first-guess
// numbers — the whole point of #25 is to have the data to tune them.

export const MONTHLY_CAMPAIGN_CAP_CENTS: Record<PlanTier, number> = {
  free: 0,
  starter: 100_00, // $100/mo
  agency: 500_00, // $500/mo
};

/**
 * Thrown by `assertUnderCap` when the projected cost would exceed the plan cap.
 * Distinct error class so the API layer can 402 (Payment Required) instead of 500.
 */
export class CampaignCostCapExceeded extends Error {
  readonly code = "CAMPAIGN_COST_CAP_EXCEEDED";
  readonly plan: PlanTier;
  readonly capCents: number;
  readonly monthToDateCents: number;
  readonly projectedCents: number;
  constructor(plan: PlanTier, capCents: number, monthToDateCents: number, projectedCents: number) {
    super(
      `Active-pentest cost cap exceeded on plan "${plan}": ` +
        `month-to-date ${monthToDateCents}¢ + projected ${projectedCents}¢ > cap ${capCents}¢`,
    );
    this.name = "CampaignCostCapExceeded";
    this.plan = plan;
    this.capCents = capCents;
    this.monthToDateCents = monthToDateCents;
    this.projectedCents = projectedCents;
  }
}

/**
 * Refuse the campaign if month-to-date campaign spend plus a projected upper
 * bound would blow past the plan cap. `projectedCents` is an upper-bound guess
 * (e.g. specialists × max steps × output-heavy-per-step); the caller is
 * expected to be conservative rather than optimistic here.
 */
export function assertUnderCap(
  plan: PlanTier,
  monthToDateCents: number,
  projectedCents: number,
): void {
  const cap = MONTHLY_CAMPAIGN_CAP_CENTS[plan];
  if (monthToDateCents + projectedCents > cap) {
    throw new CampaignCostCapExceeded(plan, cap, monthToDateCents, projectedCents);
  }
}
