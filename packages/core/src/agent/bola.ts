// Agentic BOLA (broken object-level authorization) tester.
//
// Claude plans the test — which endpoints to try, which object IDs to swap — but
// the actual access attempts run through a deterministic backend, and a finding
// is only recorded if a real probe CONFIRMED cross-account access. The model
// cannot fabricate a vulnerability: report_finding is rejected unless a prior
// probe returned crossAccountAccess === true. This keeps the precision of the
// deterministic layer while letting the agent explore.
//
// Runs ONLY through the consent gate — same chokepoint as the non-agentic path.

import type { AgentTool, LlmAgentDriver, ToolCall, ToolExecutor, ToolResult } from "./loop.js";
import { runAgent } from "./loop.js";
import { buildBolaReport, type BolaReport } from "../remediation/bola-report.js";
import { runWithActiveTestConsent, type ConsentStore, type AuditLogger } from "../consent.js";

/** Deterministic backend that actually talks to the customer's app (via the two
 *  authorized test sessions). Injected — real impl in the worker, mock in tests. */
export interface BolaProbeBackend {
  /** endpoints discovered from the schema / crawl, with the id-like parameter. */
  listEndpoints(projectId: string): Promise<
    { endpoint: string; resourceKind: string; idParameter: string }[]
  >;
  /** attempt to read account B's resource using account A's session. Returns only
   *  whether cross-account access happened — never the third party's data. */
  probe(
    projectId: string,
    endpoint: string,
    parameter: string,
  ): Promise<{ crossAccountAccess: boolean }>;
}

export const BOLA_TOOLS: AgentTool[] = [
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

/** Executor: dispatches BOLA tools and collects confirmed findings. */
class BolaToolExecutor implements ToolExecutor {
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
 * Run the agentic BOLA test. Consent-gated: throws ConsentRequiredError if the
 * project has no valid, non-revoked active-test consent. Returns the confirmed
 * findings (each queued for human review).
 */
export async function runBolaAgent(
  deps: BolaAgentDeps,
  ctx: BolaAgentContext,
): Promise<{ findings: BolaReport[]; transcript: string[] }> {
  return runWithActiveTestConsent(
    { store: deps.consent, audit: deps.audit },
    { orgId: ctx.orgId, projectId: ctx.projectId, actorId: ctx.jobId, action: "bola_agent" },
    async () => {
      const executor = new BolaToolExecutor(deps.backend, ctx.projectId);
      const { transcript } = await runAgent(deps.driver, executor, {
        system: BOLA_SYSTEM,
        tools: BOLA_TOOLS,
        prompt: `Test project ${ctx.projectId} for broken object-level authorization.`,
      });
      return { findings: executor.findings, transcript };
    },
  );
}
