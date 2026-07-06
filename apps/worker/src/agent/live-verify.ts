// Shared harness for the live-driver variants of the specialist verify scripts
// (issue #26).
//
// Each verify-<name>-target-live.ts declares WHAT to test (specialist, backend
// factory, expected assertions) and delegates the wiring (env gate, driver
// creation, cost printing) to runLiveVerify() here — so all seven live variants
// stay short and identical in structure.
//
// Gate: KELP_ANTHROPIC_LIVE=1 must be set. Absent, the script prints why it
// skipped and exits 0 (do NOT fail CI on missing opt-in). The gate is
// deliberately explicit — the point of the live variant is to burn tokens
// against the real API, and running it by accident (e.g. as part of a broad
// verify sweep) is exactly what we want to prevent.

import Anthropic from "@anthropic-ai/sdk";
import { runCampaignUnsafe, type SpecialistEntry } from "@kelp/core";
import type { Specialist } from "@kelp/core";
import { createAnthropicDriver } from "./anthropic-driver.js";

/**
 * A tiny assertion the live variant declares — takes the confirmed findings the
 * specialist produced and returns whether the check passed and how to explain
 * it. Not a full test framework, but enough to fail loudly.
 */
export interface LiveAssertion<Finding> {
  message: string;
  check: (findings: Finding[]) => boolean;
}

/**
 * Shape a caller passes runLiveVerify. Backend and Finding are opaque here on
 * purpose — every specialist has a different backend/finding type, and the
 * harness only ever plumbs them through, so demanding the strict Specialist
 * generics would force each call site into ceremonial casts. The typechecked
 * boundary lives inside each specialist itself.
 */
export interface LiveVerifyOpts<Finding> {
  /** display name for the log header, e.g. "auth-bypass" */
  name: string;
  /** the specialist under test — passed opaquely */
  specialist: Specialist<unknown, unknown>;
  /** builds the deterministic backend the specialist tools call into */
  makeBackend: () => Promise<unknown>;
  /** Claude model to drive; defaults to haiku for cheap coverage */
  model?: string;
  /** agent loop step cap */
  maxSteps?: number;
  /** assertions checked against the specialist's confirmed findings */
  assertions: LiveAssertion<Finding>[];
}

const DEFAULT_MODEL = "claude-haiku-4-5";
const DEFAULT_MAX_STEPS = 12;

/** Standard live-verify entry — call from each verify-<name>-target-live.ts. */
export async function runLiveVerify<Finding>(opts: LiveVerifyOpts<Finding>): Promise<void> {
  const model = opts.model ?? DEFAULT_MODEL;
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;

  console.log(`kelp verify-${opts.name}-target-live → model=${model} (max ${maxSteps} steps)`);

  if (process.env.KELP_ANTHROPIC_LIVE !== "1") {
    console.log(`  · skipping: KELP_ANTHROPIC_LIVE=1 not set (this variant burns real tokens)`);
    process.exit(0);
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("  · ANTHROPIC_API_KEY is not set — a live variant cannot run without it");
    process.exit(1);
  }

  const backend = await opts.makeBackend();
  const client = new Anthropic({ apiKey });
  const driver = createAnthropicDriver(client, model);

  const entry: SpecialistEntry<unknown, unknown> = {
    specialist: opts.specialist as unknown as SpecialistEntry<unknown, unknown>["specialist"],
    backend: backend as unknown,
    driver,
  };

  const ctx = { orgId: "test-org", projectId: `test-target-live-${opts.name}`, jobId: `verify-live-${opts.name}` };
  const startedAt = performance.now();
  const report = await runCampaignUnsafe(ctx, { entries: [entry], maxStepsPer: maxSteps });
  const wallMs = Math.round(performance.now() - startedAt);

  const outcome = report.outcomes[0]!;
  const findings = outcome.findings as Finding[];

  console.log(
    `\noutcome: ${outcome.name} (steps=${outcome.steps}, findings=${findings.length}, error=${outcome.error ?? "none"}, ${wallMs}ms)`,
  );
  if (report.totalUsage.inputTokens > 0 || report.totalUsage.outputTokens > 0) {
    console.log(
      `usage:   ${report.totalUsage.inputTokens} in + ${report.totalUsage.outputTokens} out tokens ≈ $${report.totalUsage.estimatedCostUsd.toFixed(4)}`,
    );
  }
  if (outcome.error) {
    console.error(`✗ specialist crashed: ${outcome.error}`);
    process.exit(1);
  }

  let failures = 0;
  for (const a of opts.assertions) {
    if (a.check(findings)) {
      console.log(`✓ ${a.message}`);
    } else {
      console.error(`✗ ${a.message}`);
      failures++;
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}
