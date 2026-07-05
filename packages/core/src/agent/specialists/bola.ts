// BOLA (broken object-level authorization) specialist.
//
// Migrated from the standalone runBolaAgent so it now plugs into the
// Orchestrator alongside future specialists (auth, injection, SSRF, RLS-deep,
// exposure, weak crypto). The behavior is unchanged — same tools, same system
// prompt, same "no confirmed evidence = no finding" invariant enforced by the
// executor. The old runBolaAgent still works for backward compat (delegates
// to the specialist via the orchestrator).

import type { BolaReport } from "../../remediation/bola-report.js";
import { buildBolaReport } from "../../remediation/bola-report.js";
import type { AgentTool, ToolCall, ToolResult } from "../loop.js";
import type { Specialist, SpecialistContext, SpecialistExecutor } from "../specialist.js";

/**
 * Deterministic backend the BOLA tools call into. The real implementation
 * (in the worker) authenticates as two test accounts and replays object-level
 * requests; the executor NEVER sees or persists the third party's data — only
 * whether cross-account access happened.
 */
export interface BolaProbeBackend {
  /** endpoints discovered from the schema / crawl, with the id-like parameter. */
  listEndpoints(projectId: string): Promise<
    { endpoint: string; resourceKind: string; idParameter: string }[]
  >;
  /** attempt to read account B's resource using account A's session. */
  probe(
    projectId: string,
    endpoint: string,
    parameter: string,
  ): Promise<{ crossAccountAccess: boolean }>;
}

const BOLA_TOOLS: AgentTool[] = [
  {
    name: "list_endpoints",
    description:
      "List the API endpoints discovered for this project, each with the parameter " +
      "that identifies the object (e.g. an id). Call this first.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "probe_endpoint",
    description:
      "Using test account A's session, attempt to access a resource owned by test " +
      "account B on the given endpoint by manipulating the parameter. Returns whether " +
      "cross-account access succeeded. Never returns the other account's data.",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: { type: "string" },
        parameter: { type: "string" },
      },
      required: ["endpoint", "parameter"],
      additionalProperties: false,
    },
  },
  {
    name: "report_finding",
    description:
      "Record a confirmed broken-authorization finding. Only allowed after a " +
      "probe_endpoint call on the same endpoint+parameter returned success.",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: { type: "string" },
        parameter: { type: "string" },
        resourceKind: { type: "string" },
      },
      required: ["endpoint", "parameter", "resourceKind"],
      additionalProperties: false,
    },
  },
];

const BOLA_SYSTEM =
  "You are Kelp's authorized security tester, checking a single connected project " +
  "for broken object-level authorization (BOLA/IDOR). You have explicit consent to " +
  "test this project. Plan efficiently: first list the endpoints, then probe the ones " +
  "most likely to leak another user's data (anything returning a user-owned record by " +
  "id). Only report endpoints where a probe confirmed cross-account access. Never " +
  "attempt to exfiltrate or display real user data. When you have probed the relevant " +
  "endpoints and reported the confirmed issues, stop.";

/**
 * BOLA executor. Enforces the load-bearing invariant: report_finding is
 * REJECTED unless a preceding probe_endpoint on the same (endpoint, parameter)
 * returned crossAccountAccess = true. The model cannot fabricate a finding.
 */
class BolaToolExecutor implements SpecialistExecutor<BolaReport> {
  readonly findings: BolaReport[] = [];
  private readonly confirmed = new Set<string>();
  private readonly reported = new Set<string>();

  constructor(
    private readonly backend: BolaProbeBackend,
    private readonly projectId: string,
  ) {}

  private key(endpoint: string, parameter: string): string {
    return `${endpoint}|${parameter}`;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      if (call.name === "list_endpoints") {
        const eps = await this.backend.listEndpoints(this.projectId);
        return { toolCallId: call.id, content: JSON.stringify(eps) };
      }

      if (call.name === "probe_endpoint") {
        const endpoint = String(call.input.endpoint ?? "");
        const parameter = String(call.input.parameter ?? "");
        const { crossAccountAccess } = await this.backend.probe(this.projectId, endpoint, parameter);
        if (crossAccountAccess) this.confirmed.add(this.key(endpoint, parameter));
        return {
          toolCallId: call.id,
          content: crossAccountAccess
            ? "cross-account access SUCCEEDED — account A read account B's resource"
            : "denied — authorization is enforced on this endpoint",
        };
      }

      if (call.name === "report_finding") {
        const endpoint = String(call.input.endpoint ?? "");
        const parameter = String(call.input.parameter ?? "");
        const resourceKind = String(call.input.resourceKind ?? "resource");
        const k = this.key(endpoint, parameter);
        if (!this.confirmed.has(k)) {
          return {
            toolCallId: call.id,
            isError: true,
            content: "rejected — no successful probe confirms this endpoint; probe it first",
          };
        }
        if (!this.reported.has(k)) {
          this.reported.add(k);
          const report = buildBolaReport({
            endpoint,
            resourceKind,
            crossAccountAccess: true,
            parameter,
          });
          if (report) this.findings.push(report);
        }
        return { toolCallId: call.id, content: "finding recorded for human review" };
      }

      return { toolCallId: call.id, isError: true, content: `unknown tool ${call.name}` };
    } catch (e) {
      return {
        toolCallId: call.id,
        isError: true,
        content: `tool error: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
}

/** The BOLA specialist — plug into the orchestrator. */
export const bolaSpecialist: Specialist<BolaProbeBackend, BolaReport> = {
  name: "bola",
  vulnClass: "bola",
  systemPrompt: BOLA_SYSTEM,
  tools: BOLA_TOOLS,
  initialPrompt(ctx: SpecialistContext): string {
    return `Test project ${ctx.projectId} for broken object-level authorization.`;
  },
  createExecutor(backend: BolaProbeBackend, ctx: SpecialistContext): SpecialistExecutor<BolaReport> {
    return new BolaToolExecutor(backend, ctx.projectId);
  },
};
