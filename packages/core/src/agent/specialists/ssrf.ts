// SSRF (server-side request forgery) specialist.
//
// Hunts for endpoints where a caller-controlled URL is fetched server-side.
// The confirmation pattern is *out-of-band evidence*: the backend spins up
// (or already runs) a listener the specialist controls, feeds the target
// endpoint a probe URL pointing at that listener, and treats a hit on the
// listener as unforgeable proof — the target's server actually made the
// request. That's stronger than any heuristic on the response body.
//
// Same load-bearing invariant as every other Kelp specialist:
// `report_finding` is refused unless a matching `probe_ssrf` on the same
// (endpoint, technique) returned bypassed=true.

import { fingerprint } from "../../fingerprint.js";
import type { Severity } from "../../types.js";
import type { AgentTool, ToolCall, ToolResult } from "../loop.js";
import type { Specialist, SpecialistContext, SpecialistExecutor } from "../specialist.js";

/** Techniques the specialist knows how to probe. */
export type SsrfTechnique =
  | "plain_http"          // http://<callback>/probe          — no obfuscation
  | "loopback_127"        // http://127.0.0.1:<port>/probe    — bypasses naive "no localhost" rules
  | "loopback_localhost"  // http://localhost:<port>/probe    — bypasses naive "no 127.0.0.1" rules
  | "url_encoded_host"    // http://%31%32%37%2E%30%2E%30%2E%31:<port>/probe — bypasses byte-level filters
  | "metadata_ip";        // http://169.254.169.254/...       — AWS/GCP metadata IP; won't hit our callback

/** Deterministic backend the SSRF tools call into. */
export interface SsrfBackend {
  /** Endpoints reachable on the project that accept a URL parameter. */
  listEndpoints(projectId: string): Promise<
    { endpoint: string; parameter: string; description?: string }[]
  >;
  /**
   * Probe an endpoint+parameter with an out-of-band callback technique.
   * The backend generates a one-time probe URL, sends the target a request
   * with that URL as the parameter, then waits briefly for the callback to
   * fire. If it fires with the matching token, the fetch was made — that's
   * the confirmation. Never returns third-party bodies.
   */
  probe(
    projectId: string,
    endpoint: string,
    parameter: string,
    technique: SsrfTechnique,
  ): Promise<{ bypassed: boolean }>;
}

/** A confirmed SSRF finding. */
export interface SsrfReport {
  fingerprint: string;
  severity: Severity;
  title: string;
  endpoint: string;
  parameter: string;
  technique: SsrfTechnique;
  evidence: string;
  status: "needs_review";
}

const SSRF_TOOLS: AgentTool[] = [
  {
    name: "list_endpoints",
    description:
      "List the endpoints discovered for this project that accept a URL " +
      "parameter — those are the SSRF surface. Call this first.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "probe_ssrf",
    description:
      "Probe an endpoint+parameter for SSRF by feeding the endpoint a probe " +
      "URL that points at a listener the deterministic backend controls. The " +
      "backend confirms the SSRF when the listener records the matching hit. " +
      "Never returns third-party response bodies.",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: { type: "string" },
        parameter: { type: "string" },
        technique: {
          type: "string",
          enum: [
            "plain_http",
            "loopback_127",
            "loopback_localhost",
            "url_encoded_host",
            "metadata_ip",
          ],
        },
      },
      required: ["endpoint", "parameter", "technique"],
      additionalProperties: false,
    },
  },
  {
    name: "report_finding",
    description:
      "Record a confirmed SSRF finding. ONLY allowed after a matching " +
      "probe_ssrf on the same endpoint+parameter+technique returned bypassed=true.",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: { type: "string" },
        parameter: { type: "string" },
        technique: {
          type: "string",
          enum: [
            "plain_http",
            "loopback_127",
            "loopback_localhost",
            "url_encoded_host",
            "metadata_ip",
          ],
        },
      },
      required: ["endpoint", "parameter", "technique"],
      additionalProperties: false,
    },
  },
];

const SSRF_SYSTEM =
  "You are Kelp's authorized security tester, checking a single connected " +
  "project for server-side request forgery (SSRF). You have explicit consent " +
  "to test this project. Plan efficiently: first list the endpoints that " +
  "accept a URL parameter (webhook forwarders, avatar mirrors, \"import from " +
  "URL\" flows), then probe each with the impersonation techniques you know. " +
  "The deterministic backend confirms a bypass by out-of-band evidence — a " +
  "callback it controls fired when the target actually fetched the probe URL. " +
  "Only report endpoints where a probe confirmed the bypass. Never attempt " +
  "to exfiltrate metadata or internal-network data. Stop once you've probed " +
  "the surface and reported confirmed issues.";

/**
 * SSRF executor. Same invariant every other Kelp specialist enforces:
 * report_finding is REJECTED unless a preceding probe_ssrf on the same
 * (endpoint, parameter, technique) returned bypassed = true.
 */
class SsrfExecutor implements SpecialistExecutor<SsrfReport> {
  readonly findings: SsrfReport[] = [];
  private readonly confirmed = new Set<string>();
  private readonly reported = new Set<string>();

  constructor(
    private readonly backend: SsrfBackend,
    private readonly projectId: string,
  ) {}

  private key(endpoint: string, parameter: string, technique: string): string {
    return `${endpoint}|${parameter}|${technique}`;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      if (call.name === "list_endpoints") {
        const eps = await this.backend.listEndpoints(this.projectId);
        return { toolCallId: call.id, content: JSON.stringify(eps) };
      }

      if (call.name === "probe_ssrf") {
        const endpoint = String(call.input.endpoint ?? "");
        const parameter = String(call.input.parameter ?? "");
        const technique = String(call.input.technique ?? "") as SsrfTechnique;
        const { bypassed } = await this.backend.probe(this.projectId, endpoint, parameter, technique);
        if (bypassed) this.confirmed.add(this.key(endpoint, parameter, technique));
        return {
          toolCallId: call.id,
          content: bypassed
            ? `SSRF CONFIRMED — technique ${technique} on ${endpoint} fired the callback`
            : "denied — the callback did not fire; the endpoint either refused or normalised the URL",
        };
      }

      if (call.name === "report_finding") {
        const endpoint = String(call.input.endpoint ?? "");
        const parameter = String(call.input.parameter ?? "");
        const technique = String(call.input.technique ?? "") as SsrfTechnique;
        const k = this.key(endpoint, parameter, technique);
        if (!this.confirmed.has(k)) {
          return {
            toolCallId: call.id,
            isError: true,
            content: "rejected — no successful probe confirms this endpoint/parameter/technique",
          };
        }
        if (!this.reported.has(k)) {
          this.reported.add(k);
          this.findings.push({
            fingerprint: fingerprint(["ssrf", endpoint, parameter, technique]),
            severity: "high",
            title: `Server-side request forgery on ${endpoint} via ${parameter} (${technique})`,
            endpoint,
            parameter,
            technique,
            evidence:
              `A probe from Kelp's authorized test, feeding a callback URL via ` +
              `the "${technique}" technique to ${endpoint}, caused the target ` +
              `to fetch a URL it should not have — the callback listener recorded ` +
              `the matching hit.`,
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

/** The SSRF specialist — plug into the orchestrator alongside BOLA/auth/injection. */
export const ssrfSpecialist: Specialist<SsrfBackend, SsrfReport> = {
  name: "ssrf",
  vulnClass: "ssrf",
  systemPrompt: SSRF_SYSTEM,
  tools: SSRF_TOOLS,
  initialPrompt(ctx: SpecialistContext): string {
    return `Test project ${ctx.projectId} for server-side request forgery.`;
  },
  createExecutor(backend: SsrfBackend, ctx: SpecialistContext): SpecialistExecutor<SsrfReport> {
    return new SsrfExecutor(backend, ctx.projectId);
  },
};
