// Data-exposure specialist.
//
// Hunts for authenticated GET endpoints that return sensitive fields — the
// classic "select *" mistake that ships password hashes, reset tokens, and
// third-party secrets to the browser. Different detection shape from every
// other specialist: no fuzzing, no cross-account probe, no out-of-band
// callback — the specialist audits the *shape* of the response (field names,
// never values) and flags an endpoint when the shape contains a name matching
// a small dictionary of high-risk terms.
//
// **Data-hygiene invariant** (in addition to the usual "no confirmed probe →
// no finding"): the backend's `probeResponseShape` MUST return only field
// names extracted from the response — never values. Every backend
// implementation must be reviewed against this rule. See
// `test-target-exposure-backend.ts` for the reference implementation.

import { fingerprint } from "../../fingerprint.js";
import type { Severity } from "../../types.js";
import type { AgentTool, ToolCall, ToolResult } from "../loop.js";
import type { Specialist, SpecialistContext, SpecialistExecutor } from "../specialist.js";

/** Deterministic backend the exposure tools call into. */
export interface ExposureBackend {
  /** Authenticated GET endpoints reachable on the project. */
  listEndpoints(projectId: string): Promise<
    { endpoint: string; description?: string }[]
  >;
  /**
   * Fetch the endpoint (as the test account) and return ONLY the top-level
   * field names of the response. Nested objects contribute their key names
   * too (flattened, one level deep). Values MUST NEVER be returned, logged
   * or persisted — the entire point is to keep third-party data out of the
   * specialist's transcript.
   */
  probeResponseShape(
    projectId: string,
    endpoint: string,
  ): Promise<{ fieldNames: string[] }>;
}

/** A confirmed data-exposure finding. */
export interface ExposureReport {
  fingerprint: string;
  severity: Severity;
  title: string;
  endpoint: string;
  /** the sensitive field names Kelp flagged — never values */
  sensitiveFields: string[];
  evidence: string;
  status: "needs_review";
}

/**
 * The dictionary of field names Kelp treats as "the endpoint is leaking
 * something it should not". Kept short on purpose: false positives here
 * cost trust immediately. Names are normalised to lowercase and stripped
 * of underscores / camelCase before matching, so `passwordHash`,
 * `password_hash`, `PASSWORD_HASH` and `pwHash` all match the same entry.
 */
const SENSITIVE_TERMS = [
  "password",
  "passwordhash",
  "pwhash",
  "salt",
  "otpsecret",
  "totpsecret",
  "stripesecret",
  "stripekey",
  "refreshtoken",
  "resettoken",
  "passwordresettoken",
  "sessionsecret",
  "apisecret",
  "privatekey",
];

function normalise(name: string): string {
  return name.toLowerCase().replace(/[_\-\s]/g, "");
}

/** Which sensitive terms (if any) the given field-name list matches. */
export function matchSensitive(fieldNames: readonly string[]): string[] {
  const hit: string[] = [];
  for (const f of fieldNames) {
    const n = normalise(f);
    for (const term of SENSITIVE_TERMS) {
      if (n === term || n.includes(term)) {
        if (!hit.includes(f)) hit.push(f);
        break;
      }
    }
  }
  return hit;
}

const EXPOSURE_TOOLS: AgentTool[] = [
  {
    name: "list_endpoints",
    description:
      "List the authenticated GET endpoints discovered for this project. " +
      "Call this first — data exposure hides in the response shape of any " +
      "endpoint returning objects.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "probe_response_shape",
    description:
      "Fetch the endpoint as Kelp's test account and return the field names " +
      "of the response. Values are NEVER returned — only names. Call this " +
      "for every listed endpoint you want to audit.",
    inputSchema: {
      type: "object",
      properties: { endpoint: { type: "string" } },
      required: ["endpoint"],
      additionalProperties: false,
    },
  },
  {
    name: "report_finding",
    description:
      "Record a confirmed data-exposure finding. ONLY allowed after a " +
      "matching probe_response_shape on the same endpoint returned field " +
      "names that include one of Kelp's known-sensitive terms. Kelp — not " +
      "the model — decides whether the field names count as sensitive.",
    inputSchema: {
      type: "object",
      properties: { endpoint: { type: "string" } },
      required: ["endpoint"],
      additionalProperties: false,
    },
  },
];

const EXPOSURE_SYSTEM =
  "You are Kelp's authorized security tester, auditing a single connected " +
  "project for endpoints that leak sensitive fields in their response bodies. " +
  "You have explicit consent to test this project. Plan efficiently: first " +
  "list the authenticated GET endpoints, then probe the response shape of the " +
  "ones most likely to return user or account state (admin lists, /me, /users). " +
  "You never see values — only field names. Only report endpoints Kelp confirms " +
  "as leaking sensitive fields via probe_response_shape. Stop once you have " +
  "audited the surface.";

/**
 * Exposure executor. Two-part invariant:
 *   (1) `report_finding` is rejected unless a matching `probe_response_shape`
 *       was called on the same endpoint AND the field names Kelp returned
 *       match the sensitive dictionary. The MODEL never decides what
 *       counts — the executor holds the dictionary.
 *   (2) The backend guarantees no values ever cross the tool boundary.
 */
class ExposureExecutor implements SpecialistExecutor<ExposureReport> {
  readonly findings: ExposureReport[] = [];
  private readonly confirmed = new Map<string, string[]>();
  private readonly reported = new Set<string>();

  constructor(
    private readonly backend: ExposureBackend,
    private readonly projectId: string,
  ) {}

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      if (call.name === "list_endpoints") {
        const eps = await this.backend.listEndpoints(this.projectId);
        return { toolCallId: call.id, content: JSON.stringify(eps) };
      }

      if (call.name === "probe_response_shape") {
        const endpoint = String(call.input.endpoint ?? "");
        const { fieldNames } = await this.backend.probeResponseShape(this.projectId, endpoint);
        const sensitive = matchSensitive(fieldNames);
        if (sensitive.length > 0) this.confirmed.set(endpoint, sensitive);
        return {
          toolCallId: call.id,
          content:
            sensitive.length > 0
              ? `EXPOSURE CONFIRMED — response includes sensitive field(s): ${sensitive.join(", ")}`
              : `no sensitive fields in response shape (${fieldNames.length} field(s) audited)`,
        };
      }

      if (call.name === "report_finding") {
        const endpoint = String(call.input.endpoint ?? "");
        const sensitive = this.confirmed.get(endpoint);
        if (!sensitive) {
          return {
            toolCallId: call.id,
            isError: true,
            content:
              "rejected — no probe_response_shape on this endpoint has confirmed sensitive fields",
          };
        }
        if (!this.reported.has(endpoint)) {
          this.reported.add(endpoint);
          this.findings.push({
            fingerprint: fingerprint(["exposure", endpoint, ...sensitive]),
            severity: "high",
            title: `Response body leaks sensitive field(s) on ${endpoint}`,
            endpoint,
            sensitiveFields: sensitive,
            evidence:
              `A probe from Kelp's authorized test called ${endpoint} and Kelp's ` +
              `field-name auditor matched the response shape against its sensitive-terms ` +
              `dictionary. The following field name(s) triggered the rule: ${sensitive.join(", ")}. ` +
              `The values were never inspected, logged or persisted.`,
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

/** The exposure specialist — plug into the orchestrator alongside the others. */
export const exposureSpecialist: Specialist<ExposureBackend, ExposureReport> = {
  name: "exposure",
  vulnClass: "exposure",
  systemPrompt: EXPOSURE_SYSTEM,
  tools: EXPOSURE_TOOLS,
  initialPrompt(ctx: SpecialistContext): string {
    return `Audit project ${ctx.projectId} for response bodies that leak sensitive fields.`;
  },
  createExecutor(backend: ExposureBackend, ctx: SpecialistContext): SpecialistExecutor<ExposureReport> {
    return new ExposureExecutor(backend, ctx.projectId);
  },
};
