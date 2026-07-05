// Auth-bypass specialist.
//
// Hunts for endpoints that let a caller override the session identity — the
// classic "?as=<userId>" / "X-User: <id>" / trust-the-header pattern that
// bypasses authentication in seemingly-authenticated APIs. The specialist
// enumerates the endpoint surface, tries a small catalog of impersonation
// techniques with account A's session, and confirms a finding ONLY if the
// endpoint returned data belonging to a different account after the
// impersonation attempt.
//
// The same "no confirmed evidence → no finding" invariant BOLA enforces
// applies here: `report_finding` is rejected unless a matching
// `probe_impersonation` call has actually returned bypassed = true.

import { fingerprint } from "../../fingerprint.js";
import type { Severity } from "../../types.js";
import type { AgentTool, ToolCall, ToolResult } from "../loop.js";
import type { Specialist, SpecialistContext, SpecialistExecutor } from "../specialist.js";

/** Deterministic backend the auth-bypass tools call into. */
export interface AuthBypassBackend {
  /** Endpoints reachable on the project. */
  listEndpoints(projectId: string): Promise<
    { endpoint: string; description?: string }[]
  >;
  /**
   * Try an impersonation technique with account A's session against `endpoint`.
   * Returns whether the endpoint honored the impersonation (i.e. behaved as if
   * the caller were the impersonated user). Never returns third-party data.
   */
  probe(
    projectId: string,
    endpoint: string,
    technique: ImpersonationTechnique,
  ): Promise<{ bypassed: boolean }>;
}

/** Known impersonation techniques the specialist knows how to probe. */
export type ImpersonationTechnique =
  | "query_as_param"       // ?as=<otherUserId>
  | "x_user_header"        // X-User: <otherUserId>
  | "userid_body_override" // { userId: "<otherUserId>" } in the body
  | "token_swap";          // send the other account's token from A's context

/** A confirmed auth-bypass finding. */
export interface AuthBypassReport {
  fingerprint: string;
  severity: Severity;
  title: string;
  endpoint: string;
  technique: ImpersonationTechnique;
  evidence: string;
  status: "needs_review";
}

const AUTH_TOOLS: AgentTool[] = [
  {
    name: "list_endpoints",
    description:
      "List the endpoints discovered for this project. Call this first — an " +
      "auth-bypass can hide behind any authenticated route.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "probe_impersonation",
    description:
      "Using test account A's session, try to make an endpoint act as if the " +
      "caller were a DIFFERENT user, via one of the known impersonation " +
      "techniques. Returns whether the endpoint honored the impersonation. " +
      "Never returns the other account's data.",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: { type: "string" },
        technique: {
          type: "string",
          enum: ["query_as_param", "x_user_header", "userid_body_override", "token_swap"],
        },
      },
      required: ["endpoint", "technique"],
      additionalProperties: false,
    },
  },
  {
    name: "report_finding",
    description:
      "Record a confirmed auth-bypass finding. ONLY allowed after a matching " +
      "probe_impersonation on the same endpoint+technique returned bypassed=true.",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: { type: "string" },
        technique: {
          type: "string",
          enum: ["query_as_param", "x_user_header", "userid_body_override", "token_swap"],
        },
      },
      required: ["endpoint", "technique"],
      additionalProperties: false,
    },
  },
];

const AUTH_SYSTEM =
  "You are Kelp's authorized security tester, checking a single connected " +
  "project for authentication-bypass flaws — endpoints that allow the caller " +
  "to override the session identity. You have explicit consent to test this " +
  "project. Plan efficiently: first list the endpoints, then for each " +
  "reasonably-suspect one (endpoints that return user-owned data or admin " +
  "state), probe the impersonation techniques you know. Only report an " +
  "endpoint+technique pair where a probe confirmed the bypass. Never " +
  "attempt to exfiltrate real user data. Stop once you've probed the " +
  "surface and reported confirmed issues.";

/**
 * Auth-bypass executor. Enforces the same invariant BOLA does:
 * report_finding is REJECTED unless a preceding probe_impersonation on the
 * same (endpoint, technique) returned bypassed = true.
 */
class AuthBypassExecutor implements SpecialistExecutor<AuthBypassReport> {
  readonly findings: AuthBypassReport[] = [];
  private readonly confirmed = new Set<string>();
  private readonly reported = new Set<string>();

  constructor(
    private readonly backend: AuthBypassBackend,
    private readonly projectId: string,
  ) {}

  private key(endpoint: string, technique: string): string {
    return `${endpoint}|${technique}`;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      if (call.name === "list_endpoints") {
        const eps = await this.backend.listEndpoints(this.projectId);
        return { toolCallId: call.id, content: JSON.stringify(eps) };
      }

      if (call.name === "probe_impersonation") {
        const endpoint = String(call.input.endpoint ?? "");
        const technique = String(call.input.technique ?? "") as ImpersonationTechnique;
        const { bypassed } = await this.backend.probe(this.projectId, endpoint, technique);
        if (bypassed) this.confirmed.add(this.key(endpoint, technique));
        return {
          toolCallId: call.id,
          content: bypassed
            ? `bypass SUCCEEDED — technique ${technique} was honored on ${endpoint}`
            : "denied — the endpoint ignored the impersonation attempt",
        };
      }

      if (call.name === "report_finding") {
        const endpoint = String(call.input.endpoint ?? "");
        const technique = String(call.input.technique ?? "") as ImpersonationTechnique;
        const k = this.key(endpoint, technique);
        if (!this.confirmed.has(k)) {
          return {
            toolCallId: call.id,
            isError: true,
            content: "rejected — no successful probe confirms this endpoint/technique",
          };
        }
        if (!this.reported.has(k)) {
          this.reported.add(k);
          this.findings.push({
            fingerprint: fingerprint(["auth-bypass", endpoint, technique]),
            severity: "high",
            title: `Session identity can be overridden on ${endpoint} via ${technique}`,
            endpoint,
            technique,
            evidence:
              `A probe from Kelp's test account A, applying the ${technique} technique ` +
              `to ${endpoint}, produced a response scoped to a different user.`,
            status: "needs_review",
          });
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

/** The auth-bypass specialist — plug into the orchestrator alongside BOLA. */
export const authBypassSpecialist: Specialist<AuthBypassBackend, AuthBypassReport> = {
  name: "auth-bypass",
  vulnClass: "auth",
  systemPrompt: AUTH_SYSTEM,
  tools: AUTH_TOOLS,
  initialPrompt(ctx: SpecialistContext): string {
    return `Test project ${ctx.projectId} for authentication-bypass flaws.`;
  },
  createExecutor(backend: AuthBypassBackend, ctx: SpecialistContext): SpecialistExecutor<AuthBypassReport> {
    return new AuthBypassExecutor(backend, ctx.projectId);
  },
};
