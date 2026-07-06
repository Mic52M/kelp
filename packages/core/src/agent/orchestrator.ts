// Multi-specialist campaign orchestrator.
//
// Given N specialists, each with its own backend and its own LlmAgentDriver,
// run them in parallel (bounded by maxParallel) and aggregate the confirmed
// findings each executor produced. Errors in one specialist don't kill the
// campaign — they surface as a per-specialist error entry so the caller can
// tell "the RLS-deep agent crashed" from "the RLS-deep agent found nothing".
//
// The orchestrator is intentionally consent-agnostic: the runActivePentest
// wrapper below gates the whole campaign through runWithActiveTestConsent
// (the single legal chokepoint we already have for BOLA).

import type { VulnClass } from "../types.js";
import type { AuditLogger, ConsentStore } from "../consent.js";
import { runWithActiveTestConsent, CONSENT_ACCEPTED_FOR_MULTI_SPECIALIST } from "../consent.js";
import { runAgent, type LlmAgentDriver, type LlmUsage } from "./loop.js";
import { estimateCostUsd } from "./pricing.js";
import type { Specialist, SpecialistContext } from "./specialist.js";

/**
 * One specialist entry in a campaign: the specialist definition, its backend
 * (the deterministic surface the tools call into), and the LLM driver that
 * will drive its conversation. Each entry can use a different model (Opus for
 * planning-heavy specialists, Haiku for volume) — the driver decides.
 */
export interface SpecialistEntry<Backend, Finding> {
  specialist: Specialist<Backend, Finding>;
  backend: Backend;
  driver: LlmAgentDriver;
}

/** Token & cost usage attributed to one specialist run (issue #25). */
export interface SpecialistUsage {
  inputTokens: number;
  outputTokens: number;
  /** USD estimate — 0 if the driver's model is unknown to the rate table. */
  estimatedCostUsd: number;
}

export interface SpecialistOutcome {
  name: string;
  vulnClass: VulnClass;
  /** confirmed findings this specialist produced */
  findings: unknown[];
  /** assistant narration for the run — useful for the audit trail */
  transcript: string[];
  /** null on success, a message on failure (the specialist crashed) */
  error: string | null;
  /** how many agent loop iterations were spent */
  steps: number;
  /** null when the driver reports no usage (scripted / non-LLM drivers) */
  usage: SpecialistUsage | null;
}

export interface CampaignReport {
  outcomes: SpecialistOutcome[];
  /** flattened findings across every successful specialist */
  findings: unknown[];
  /** summed usage across every specialist that reported it (issue #25) */
  totalUsage: SpecialistUsage;
}

export interface CampaignConfig {
  entries: SpecialistEntry<unknown, unknown>[];
  /** max specialists running concurrently; defaults to `entries.length` */
  maxParallel?: number;
  /** step cap per specialist; passed through to runAgent */
  maxStepsPer?: number;
}

/**
 * Ask the driver for its cumulative usage, converting to a SpecialistUsage or
 * null if the driver doesn't implement getUsage (scripted test driver). Never
 * throws — a driver bug can't tank the whole report.
 */
function collectUsage(driver: LlmAgentDriver): SpecialistUsage | null {
  if (typeof driver.getUsage !== "function") return null;
  let raw: LlmUsage;
  try {
    raw = driver.getUsage();
  } catch {
    return null;
  }
  return {
    inputTokens: raw.inputTokens,
    outputTokens: raw.outputTokens,
    estimatedCostUsd: estimateCostUsd(raw),
  };
}

/** Run one specialist and package its outcome. Never throws. */
async function runOne(
  entry: SpecialistEntry<unknown, unknown>,
  ctx: SpecialistContext,
  maxSteps?: number,
): Promise<SpecialistOutcome> {
  const { specialist, backend, driver } = entry;
  try {
    const executor = specialist.createExecutor(backend, ctx);
    const { transcript, steps } = await runAgent(driver, executor, {
      system: specialist.systemPrompt,
      tools: specialist.tools,
      prompt: specialist.initialPrompt(ctx),
      ...(maxSteps !== undefined ? { maxSteps } : {}),
    });
    return {
      name: specialist.name,
      vulnClass: specialist.vulnClass,
      findings: [...executor.findings],
      transcript,
      error: null,
      steps,
      usage: collectUsage(driver),
    };
  } catch (e) {
    return {
      name: specialist.name,
      vulnClass: specialist.vulnClass,
      findings: [],
      transcript: [],
      error: e instanceof Error ? e.message : String(e),
      steps: 0,
      // Usage may still be non-zero if the crash happened mid-conversation.
      usage: collectUsage(driver),
    };
  }
}

/**
 * Dispatch every specialist. Enforces a concurrency limit — with 7 specialists
 * on the roadmap and Claude API rate limits per key, running them all in
 * parallel would 429 on any non-trivial project. Simple worker-pool: N workers
 * pull from a shared queue.
 */
async function runCampaign(
  ctx: SpecialistContext,
  config: CampaignConfig,
): Promise<CampaignReport> {
  const parallel = Math.max(1, config.maxParallel ?? config.entries.length);
  const queue = [...config.entries];
  const outcomes: SpecialistOutcome[] = [];

  async function worker() {
    for (;;) {
      const entry = queue.shift();
      if (!entry) return;
      outcomes.push(await runOne(entry, ctx, config.maxStepsPer));
    }
  }

  await Promise.all(Array.from({ length: parallel }, worker));

  // Preserve the specialist ordering the caller provided — makes the report
  // stable and reproducible even though execution was concurrent.
  const orderOf = new Map(config.entries.map((e, i) => [e.specialist.name, i]));
  outcomes.sort((a, b) => (orderOf.get(a.name) ?? 0) - (orderOf.get(b.name) ?? 0));

  const findings = outcomes.flatMap((o) => o.findings);
  const totalUsage: SpecialistUsage = outcomes.reduce<SpecialistUsage>(
    (acc, o) => {
      if (!o.usage) return acc;
      return {
        inputTokens: acc.inputTokens + o.usage.inputTokens,
        outputTokens: acc.outputTokens + o.usage.outputTokens,
        estimatedCostUsd: acc.estimatedCostUsd + o.usage.estimatedCostUsd,
      };
    },
    { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
  );
  return { outcomes, findings, totalUsage };
}

export interface ActivePentestDeps {
  consent: ConsentStore;
  audit: AuditLogger;
}

/**
 * The consent-gated entry point. All active-testing campaigns go through
 * here — never call runCampaign directly from anything user-facing. Throws
 * ConsentRequiredError when the project hasn't granted (or has revoked)
 * consent. On success, writes a single audit row naming the campaign; each
 * specialist is expected to write its own probe-level audit rows in its
 * backend.
 *
 * `acceptedVersions` (issue #24) defaults to the multi-specialist set (v2 only);
 * the legacy BOLA-only wrapper passes CONSENT_ACCEPTED_FOR_BOLA_ONLY so an
 * existing v1 consent still works for that one class.
 */
export async function runActivePentest(
  deps: ActivePentestDeps,
  ctx: SpecialistContext,
  config: CampaignConfig,
  opts?: { acceptedVersions?: readonly string[] },
): Promise<CampaignReport> {
  return runWithActiveTestConsent(
    { store: deps.consent, audit: deps.audit },
    {
      orgId: ctx.orgId,
      projectId: ctx.projectId,
      actorId: ctx.jobId,
      action: "active_pentest_campaign",
      acceptedVersions: opts?.acceptedVersions ?? CONSENT_ACCEPTED_FOR_MULTI_SPECIALIST,
    },
    () => runCampaign(ctx, config),
  );
}

/** Exposed for tests that want to skip the consent gate (unit-level only). */
export { runCampaign as runCampaignUnsafe };
