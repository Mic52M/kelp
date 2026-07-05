// Injection specialist.
//
// Hunts for endpoints where a caller-controlled parameter is spliced into a
// query in a way that lets the caller widen the query's scope (SQL/NoSQL
// injection). The detection pattern is deliberately deterministic: for each
// endpoint+parameter the specialist probes, we compare the baseline response
// (with an inert value) against the response under an injection payload from
// a small catalog. If any payload strictly widens the result — more rows
// returned, or evidence of authorization scope breaking — that's the
// confirmation.
//
// The load-bearing invariant is the same as BOLA and auth-bypass:
// `report_finding` is refused unless a matching `probe_injection` on the same
// (endpoint, parameter) returned `bypassed = true`. The model cannot claim an
// injection without the probe having confirmed it.

import { fingerprint } from "../../fingerprint.js";
import type { Severity } from "../../types.js";
import type { AgentTool, ToolCall, ToolResult } from "../loop.js";
import type { Specialist, SpecialistContext, SpecialistExecutor } from "../specialist.js";

/** Deterministic backend the injection tools call into. */
export interface InjectionBackend {
  /** Endpoints reachable on the project that take one or more text parameters. */
  listEndpoints(projectId: string): Promise<
    { endpoint: string; parameter: string; description?: string }[]
  >;
  /**
   * Probe an endpoint+parameter for injection. The backend tries a catalog of
   * payloads against the endpoint, comparing the response to a baseline (an
   * inert value for the same parameter). Returns whether ANY payload caused a
   * bypass and, if so, which payload family — never returns third-party data.
   */
  probe(
    projectId: string,
    endpoint: string,
    parameter: string,
  ): Promise<{ bypassed: boolean; payloadFamily?: InjectionFamily }>;
}

/** Coarse categorisation of the payload that succeeded — used in the report. */
export type InjectionFamily = "sql_or_true" | "sql_union" | "sql_terminator" | "nosql";

/** A confirmed injection finding. */
export interface InjectionReport {
  fingerprint: string;
  severity: Severity;
  title: string;
  endpoint: string;
  parameter: string;
  payloadFamily: InjectionFamily;
  evidence: string;
  status: "needs_review";
}

const INJECTION_TOOLS: AgentTool[] = [
  {
    name: "list_endpoints",
    description:
      "List the endpoints discovered for this project that accept one or more " +
      "text parameters — those are the injection surface. Call this first.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "probe_injection",
    description:
      "Probe an endpoint+parameter for SQL/NoSQL injection by comparing a " +
      "baseline response against injection payloads. Returns whether any " +
      "payload widened the query's scope and which payload family succeeded. " +
      "Never returns third-party data.",
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
      "Record a confirmed injection finding. ONLY allowed after a matching " +
      "probe_injection returned bypassed=true on the same endpoint+parameter.",
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
];

const INJECTION_SYSTEM =
  "You are Kelp's authorized security tester, checking a single connected " +
  "project for SQL/NoSQL injection flaws. You have explicit consent to test " +
  "this project. Plan efficiently: first list the endpoints with text " +
  "parameters, then probe each parameter that looks like it feeds into a " +
  "query (search terms, filters, sort keys). Only report endpoints where a " +
  "probe confirmed a bypass — the deterministic backend tries the payloads " +
  "for you and returns a verdict. Never attempt to exfiltrate real user " +
  "data. Stop once you've probed the surface and reported confirmed issues.";

/**
 * Injection executor. Same invariant BOLA and auth-bypass enforce:
 * report_finding is REJECTED unless a preceding probe_injection on the same
 * (endpoint, parameter) returned bypassed = true.
 */
class InjectionExecutor implements SpecialistExecutor<InjectionReport> {
  readonly findings: InjectionReport[] = [];
  private readonly confirmed = new Map<string, InjectionFamily>();
  private readonly reported = new Set<string>();

  constructor(
    private readonly backend: InjectionBackend,
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

      if (call.name === "probe_injection") {
        const endpoint = String(call.input.endpoint ?? "");
        const parameter = String(call.input.parameter ?? "");
        const { bypassed, payloadFamily } = await this.backend.probe(
          this.projectId,
          endpoint,
          parameter,
        );
        if (bypassed && payloadFamily) {
          this.confirmed.set(this.key(endpoint, parameter), payloadFamily);
        }
        return {
          toolCallId: call.id,
          content: bypassed
            ? `injection CONFIRMED — payload family "${payloadFamily}" widened the query on ${endpoint}`
            : "denied — no payload family widened the query",
        };
      }

      if (call.name === "report_finding") {
        const endpoint = String(call.input.endpoint ?? "");
        const parameter = String(call.input.parameter ?? "");
        const k = this.key(endpoint, parameter);
        const payloadFamily = this.confirmed.get(k);
        if (!payloadFamily) {
          return {
            toolCallId: call.id,
            isError: true,
            content: "rejected — no successful probe confirms this endpoint/parameter",
          };
        }
        if (!this.reported.has(k)) {
          this.reported.add(k);
          this.findings.push({
            fingerprint: fingerprint(["injection", endpoint, parameter, payloadFamily]),
            severity: "critical",
            title: `${classify(payloadFamily)} on ${endpoint} via parameter "${parameter}"`,
            endpoint,
            parameter,
            payloadFamily,
            evidence:
              `A probe from Kelp's test account, submitting a "${payloadFamily}" ` +
              `payload as the "${parameter}" value on ${endpoint}, caused the endpoint ` +
              `to return rows outside the caller's intended scope.`,
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

function classify(family: InjectionFamily): string {
  switch (family) {
    case "sql_or_true": return "SQL injection (OR-truth widening)";
    case "sql_union": return "SQL injection (UNION-based)";
    case "sql_terminator": return "SQL injection (statement terminator)";
    case "nosql": return "NoSQL injection";
  }
}

/** The injection specialist — plug into the orchestrator alongside BOLA/auth. */
export const injectionSpecialist: Specialist<InjectionBackend, InjectionReport> = {
  name: "injection",
  vulnClass: "injection",
  systemPrompt: INJECTION_SYSTEM,
  tools: INJECTION_TOOLS,
  initialPrompt(ctx: SpecialistContext): string {
    return `Test project ${ctx.projectId} for SQL/NoSQL injection.`;
  },
  createExecutor(backend: InjectionBackend, ctx: SpecialistContext): SpecialistExecutor<InjectionReport> {
    return new InjectionExecutor(backend, ctx.projectId);
  },
};
