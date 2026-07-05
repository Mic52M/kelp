// Legacy entry point kept for backward compatibility with the pre-orchestrator
// code path. It now delegates to the BOLA specialist through the campaign
// orchestrator — same behavior, same tests pass, but the machinery is shared
// with every future specialist (auth, injection, SSRF, RLS-deep, …).
//
// Prefer the orchestrator (runActivePentest) for new call sites — it accepts
// several specialists in one go and gives a per-specialist outcome report.

import type { AuditLogger, ConsentStore } from "../consent.js";
import type { BolaReport } from "../remediation/bola-report.js";
import type { LlmAgentDriver } from "./loop.js";
import { runActivePentest } from "./orchestrator.js";
import { bolaSpecialist, type BolaProbeBackend } from "./specialists/bola.js";

// Re-export the backend interface so existing imports (worker, tests) keep
// working without touching call sites.
export type { BolaProbeBackend } from "./specialists/bola.js";
export { bolaSpecialist } from "./specialists/bola.js";

export interface BolaAgentDeps {
  driver: LlmAgentDriver;
  backend: BolaProbeBackend;
  consent: ConsentStore;
  audit: AuditLogger;
}

export interface BolaAgentContext {
  orgId: string;
  projectId: string;
  jobId: string;
}

/**
 * Run the agentic BOLA test — one-specialist campaign, consent-gated. Kept as
 * a thin wrapper for the existing worker + tests; the underlying dispatch is
 * the shared orchestrator now.
 */
export async function runBolaAgent(
  deps: BolaAgentDeps,
  ctx: BolaAgentContext,
): Promise<{ findings: BolaReport[]; transcript: string[] }> {
  const report = await runActivePentest(
    { consent: deps.consent, audit: deps.audit },
    ctx,
    {
      entries: [
        {
          specialist: bolaSpecialist,
          backend: deps.backend,
          driver: deps.driver,
        } as unknown as import("./orchestrator.js").SpecialistEntry<unknown, unknown>,
      ],
    },
  );

  // Single-specialist campaign — there's exactly one outcome. Surface its
  // error (if any) as a throw so the previous exception contract holds.
  const outcome = report.outcomes[0]!;
  if (outcome.error) throw new Error(outcome.error);

  return {
    findings: outcome.findings as BolaReport[],
    transcript: outcome.transcript,
  };
}
