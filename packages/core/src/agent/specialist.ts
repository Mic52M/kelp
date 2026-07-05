// Specialist framework — the generalization of Kelp's existing BOLA agent.
//
// A Specialist is a self-contained pen-testing agent focused on one class of
// vulnerability: it declares its tools, its system prompt, and — critically —
// a deterministic Executor that OWNS the truth of what was found. The
// executor must preserve the invariant we already enforce for BOLA:
//
//     "no confirmed evidence in a probe → no finding, no matter what the
//      model says"
//
// This is the single strongest guarantee behind the pitch ("we never claim
// 100% coverage, but what we report is real"). Every Specialist implementation
// must uphold it — the report_* tools reject anything not backed by a probe.
//
// The interface is intentionally class-agnostic: it says nothing about BOLA,
// injection, SSRF or anything else. Adding a new specialist is just: define
// the tools, define the executor (with the invariant), plug it into the
// Orchestrator.

import type { VulnClass } from "../types.js";
import type { AgentTool, ToolExecutor } from "./loop.js";

/** Context passed to every specialist when it runs. */
export interface SpecialistContext {
  orgId: string;
  projectId: string;
  /** the scan/campaign job id; used for audit trail attribution */
  jobId: string;
}

/**
 * The executor a specialist returns to the orchestrator. It IS the ToolExecutor
 * (so the existing runAgent loop drives it), plus it exposes the confirmed
 * findings collected during the run. The `Finding` type is class-specific
 * (BolaReport, SecretFinding, RlsFinding, …).
 */
export interface SpecialistExecutor<Finding> extends ToolExecutor {
  readonly findings: readonly Finding[];
}

/**
 * A pen-testing specialist. `Backend` is the deterministic surface the tools
 * call into (per-class: HTTP probes for BOLA, DB queries for RLS-deep, …).
 * `Finding` is the class-specific finding shape.
 */
export interface Specialist<Backend, Finding> {
  /** stable identifier used in audit + telemetry */
  readonly name: string;
  /** finding classification this specialist emits — feeds into the DB enum */
  readonly vulnClass: VulnClass;
  /** system prompt for the driving LLM */
  readonly systemPrompt: string;
  /** tool schemas exposed to the LLM */
  readonly tools: AgentTool[];
  /** the first user message the agent sees; may reference the context */
  initialPrompt(ctx: SpecialistContext): string;
  /**
   * Build the deterministic executor for one campaign run. The executor OWNS
   * the "no unconfirmed findings" invariant — never delegate that to the LLM.
   */
  createExecutor(backend: Backend, ctx: SpecialistContext): SpecialistExecutor<Finding>;
}
