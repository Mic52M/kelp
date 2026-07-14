// Plan configuration + limit checks (issue #17).
//
// One authoritative table of what each plan can do. Every server-side gate
// (project creation, re-scans, continuous scanning) reads from here rather than
// hard-coding "free = 1 project". Bumping a limit is a one-file edit; the DB
// enum plan_tier is authoritative for WHICH tiers exist.
//
// This lives in @kelp/core so the web app (server actions) and the worker
// (enqueue paths) both enforce the same numbers. The `orgs.plan` column feeds
// the enforcement (see monthToDateCampaignCostCents for the paid tier's own
// cost cap in pricing.ts).

import type { PlanTier } from "./types.js";

export interface PlanConfig {
  /** Human-readable name for UI + errors. */
  name: string;
  /** Max projects a single org can have connected at once. */
  maxProjects: number;
  /**
   * How re-scans are allowed to be triggered on this plan. Free = "manual" only
   * (the user has to click Re-scan). Paid = also automated triggers (webhook
   * push, scheduled). "initial" is the very first scan, never gated.
   */
  allowedRescanTriggers: readonly string[];
  /**
   * Whether the plan can open real fix PRs (auto-fix). Free tier stays
   * report-only per the PLG strategy — findings are shown but the "Open fix PR"
   * button is disabled.
   */
  autoFixEnabled: boolean;
  /**
   * Whether the plan can run the multi-specialist active pen-test campaign
   * (#19). Free is deterministic scanners only.
   */
  activePentestEnabled: boolean;
}

/**
 * Free = viral top-of-funnel. First scan always works (the aha moment). Second
 * project or any automated re-scan → upgrade prompt. Never hard-block the FIRST
 * project — that would kill the entire PLG loop.
 */
export const PLANS: Record<PlanTier, PlanConfig> = {
  free: {
    name: "Free",
    maxProjects: 1,
    // pr_check (#36) is allowed even on Free — the GitHub Action is the
    // distribution surface; killing it on Free would kill the wedge itself.
    allowedRescanTriggers: ["initial", "manual", "pr_check"],
    autoFixEnabled: false,
    activePentestEnabled: false,
  },
  starter: {
    name: "Starter",
    maxProjects: 5,
    allowedRescanTriggers: ["initial", "manual", "webhook_push", "scheduled", "pr_check"],
    autoFixEnabled: true,
    activePentestEnabled: true,
  },
  agency: {
    name: "Agency",
    maxProjects: 25,
    allowedRescanTriggers: ["initial", "manual", "webhook_push", "scheduled", "pr_check"],
    autoFixEnabled: true,
    activePentestEnabled: true,
  },
};

/**
 * Thrown by a check when the current plan can't proceed. Carries the plan and
 * the reason so the caller (server action / API) can render an upgrade CTA
 * rather than a generic 500. `code` is stable so the UI can branch on it.
 */
export class PlanLimitError extends Error {
  readonly code: PlanLimitCode;
  readonly plan: PlanTier;
  constructor(plan: PlanTier, code: PlanLimitCode, message: string) {
    super(message);
    this.name = "PlanLimitError";
    this.plan = plan;
    this.code = code;
  }
}

export type PlanLimitCode =
  | "PROJECT_LIMIT_REACHED"
  | "RESCAN_TRIGGER_NOT_ALLOWED"
  | "AUTO_FIX_NOT_AVAILABLE"
  | "ACTIVE_PENTEST_NOT_AVAILABLE";

/**
 * Guard project creation. Refuses only when the org is over the plan's cap —
 * the FIRST project on the free tier always succeeds (that's the PLG aha).
 */
export function assertCanCreateProject(plan: PlanTier, currentProjectCount: number): void {
  const config = PLANS[plan];
  if (currentProjectCount >= config.maxProjects) {
    throw new PlanLimitError(
      plan,
      "PROJECT_LIMIT_REACHED",
      `Your ${config.name} plan allows up to ${config.maxProjects} project${
        config.maxProjects === 1 ? "" : "s"
      }. Upgrade to connect more.`,
    );
  }
}

/**
 * Guard a re-scan attempt. `trigger` matches the `scan_trigger` enum values in
 * migration 0001. Free tier accepts `initial`+`manual` only — webhooks and
 * scheduled scans are the paid promise (continuous scanning).
 */
export function assertCanTriggerRescan(plan: PlanTier, trigger: string): void {
  const config = PLANS[plan];
  if (!config.allowedRescanTriggers.includes(trigger)) {
    throw new PlanLimitError(
      plan,
      "RESCAN_TRIGGER_NOT_ALLOWED",
      `Continuous scanning (trigger: ${trigger}) requires a paid plan. Upgrade to enable ${trigger} re-scans.`,
    );
  }
}

/** Guard the "Open fix PR" auto-fix affordance. */
export function assertAutoFixAvailable(plan: PlanTier): void {
  const config = PLANS[plan];
  if (!config.autoFixEnabled) {
    throw new PlanLimitError(
      plan,
      "AUTO_FIX_NOT_AVAILABLE",
      `Auto-fix PRs are a paid feature. Your ${config.name} plan is report-only — upgrade to open fix PRs directly from findings.`,
    );
  }
}

/** Guard the multi-specialist active pen-test campaign. */
export function assertActivePentestAvailable(plan: PlanTier): void {
  const config = PLANS[plan];
  if (!config.activePentestEnabled) {
    throw new PlanLimitError(
      plan,
      "ACTIVE_PENTEST_NOT_AVAILABLE",
      `The multi-agent pen test is a paid feature. Upgrade from ${config.name} to run active campaigns.`,
    );
  }
}
