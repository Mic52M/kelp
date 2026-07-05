// Weak-crypto specialist.
//
// The seventh (last of phase 2) specialist. Audits authentication-adjacent
// crypto hygiene — starting with the highest-signal, lowest-false-positive
// sub-check: cookie flags. A `Set-Cookie` for a session identifier that
// lacks HttpOnly, Secure or SameSite is a classic vibe-coded auth mistake
// (the AI-generated snippet wrote `res.cookie(name, value)` and moved on).
//
// The detection is *audit-only*: no request is forged, no token is guessed.
// The specialist inspects the `Set-Cookie` header the endpoint returned and
// Kelp — never the LLM — decides which flags count as required. That keeps
// the false-positive rate near zero and the fix is trivial ("add HttpOnly").
//
// Same load-bearing invariant every other Kelp specialist enforces:
// `report_finding` is refused unless a matching `probe_cookie_flags` on the
// same endpoint returned a non-empty `missing` list.

import { fingerprint } from "../../fingerprint.js";
import type { Severity } from "../../types.js";
import type { AgentTool, ToolCall, ToolResult } from "../loop.js";
import type { Specialist, SpecialistContext, SpecialistExecutor } from "../specialist.js";

/** The three flags Kelp treats as required for any session-identifier cookie. */
export type RequiredCookieFlag = "HttpOnly" | "Secure" | "SameSite";
const REQUIRED_FLAGS: RequiredCookieFlag[] = ["HttpOnly", "Secure", "SameSite"];

/** Deterministic backend the weak-crypto tools call into. */
export interface WeakCryptoBackend {
  /** Endpoints that respond with `Set-Cookie`. */
  listEndpointsSettingCookies(projectId: string): Promise<
    { endpoint: string; description?: string }[]
  >;
  /**
   * Fetch the endpoint (as the test account), read the Set-Cookie header, and
   * return which required flags are present vs missing on any session-identifier-
   * looking cookie. Never reads or persists the cookie value.
   */
  probeCookieFlags(
    projectId: string,
    endpoint: string,
  ): Promise<{
    /** cookie name Kelp inspected — never the value */
    cookieName: string | null;
    present: RequiredCookieFlag[];
    missing: RequiredCookieFlag[];
  }>;
}

/** A confirmed weak-crypto finding. */
export interface WeakCryptoReport {
  fingerprint: string;
  severity: Severity;
  title: string;
  endpoint: string;
  cookieName: string;
  missingFlags: RequiredCookieFlag[];
  evidence: string;
  status: "needs_review";
}

const WEAK_CRYPTO_TOOLS: AgentTool[] = [
  {
    name: "list_endpoints",
    description:
      "List the endpoints on this project that respond with Set-Cookie. Call " +
      "this first.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "probe_cookie_flags",
    description:
      "Fetch the endpoint as Kelp's test account, inspect the Set-Cookie " +
      "header, and return which required flags (HttpOnly, Secure, SameSite) " +
      "are present or missing on the session-identifier cookie. Never reads " +
      "the cookie value.",
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
      "Record a confirmed weak-crypto finding. ONLY allowed after a matching " +
      "probe_cookie_flags on the same endpoint reported at least one required " +
      "flag missing. Kelp — not the model — decides which flags are required.",
    inputSchema: {
      type: "object",
      properties: { endpoint: { type: "string" } },
      required: ["endpoint"],
      additionalProperties: false,
    },
  },
];

const WEAK_CRYPTO_SYSTEM =
  "You are Kelp's authorized security tester, auditing a single connected " +
  "project for weak authentication crypto — starting with cookie hygiene. " +
  "You have explicit consent to test this project. Plan efficiently: first " +
  "list the endpoints that respond with Set-Cookie, then probe each one to " +
  "see which required flags are present. You never see the cookie value — " +
  "only the flags. Only report endpoints Kelp confirms as missing at least " +
  "one required flag via probe_cookie_flags. Stop once you have audited the " +
  "surface.";

/**
 * Weak-crypto executor. Two-part invariant, mirroring the exposure specialist:
 *   (1) `report_finding` refused unless a matching `probe_cookie_flags` on the
 *       same endpoint reported at least one required flag missing.
 *   (2) The backend guarantees the cookie value is never returned to the tool
 *       boundary — only flag names.
 */
class WeakCryptoExecutor implements SpecialistExecutor<WeakCryptoReport> {
  readonly findings: WeakCryptoReport[] = [];
  private readonly confirmed = new Map<string, { cookieName: string; missing: RequiredCookieFlag[] }>();
  private readonly reported = new Set<string>();

  constructor(
    private readonly backend: WeakCryptoBackend,
    private readonly projectId: string,
  ) {}

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      if (call.name === "list_endpoints") {
        const eps = await this.backend.listEndpointsSettingCookies(this.projectId);
        return { toolCallId: call.id, content: JSON.stringify(eps) };
      }

      if (call.name === "probe_cookie_flags") {
        const endpoint = String(call.input.endpoint ?? "");
        const { cookieName, present, missing } = await this.backend.probeCookieFlags(this.projectId, endpoint);
        if (cookieName && missing.length > 0) {
          this.confirmed.set(endpoint, { cookieName, missing });
        }
        return {
          toolCallId: call.id,
          content:
            missing.length > 0 && cookieName
              ? `WEAK-CRYPTO CONFIRMED — cookie "${cookieName}" is missing flags: ${missing.join(", ")}. Present: ${present.join(", ") || "none"}.`
              : cookieName
                ? `no missing flags — cookie "${cookieName}" carries ${present.join(", ")}`
                : "denied — no Set-Cookie header on the response",
        };
      }

      if (call.name === "report_finding") {
        const endpoint = String(call.input.endpoint ?? "");
        const confirmed = this.confirmed.get(endpoint);
        if (!confirmed) {
          return {
            toolCallId: call.id,
            isError: true,
            content:
              "rejected — no probe_cookie_flags on this endpoint reported missing required flags",
          };
        }
        if (!this.reported.has(endpoint)) {
          this.reported.add(endpoint);
          this.findings.push({
            fingerprint: fingerprint(["weak-crypto", endpoint, confirmed.cookieName, ...confirmed.missing]),
            severity: "medium",
            title: `Session cookie on ${endpoint} is missing required flag(s): ${confirmed.missing.join(", ")}`,
            endpoint,
            cookieName: confirmed.cookieName,
            missingFlags: confirmed.missing,
            evidence:
              `A probe from Kelp's authorized test called ${endpoint} and read the ` +
              `Set-Cookie header. Kelp's flag auditor found that cookie "${confirmed.cookieName}" ` +
              `is missing the following required flag(s): ${confirmed.missing.join(", ")}. ` +
              `The cookie's value was never inspected, logged or persisted.`,
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

/** Given a raw Set-Cookie header value, return which required flags are present/missing. */
export function auditSetCookie(header: string): {
  cookieName: string | null;
  present: RequiredCookieFlag[];
  missing: RequiredCookieFlag[];
} {
  // Cookie name is the first token before "=".
  const eq = header.indexOf("=");
  const cookieName = eq > 0 ? header.slice(0, eq).trim() : null;
  const lowered = header.toLowerCase();
  const present: RequiredCookieFlag[] = [];
  for (const flag of REQUIRED_FLAGS) {
    // Attribute-style match: "; httponly", "; secure", "; samesite=..."
    const needle = `; ${flag.toLowerCase()}`;
    if (lowered.includes(needle) || lowered.startsWith(`${flag.toLowerCase()};`)) {
      present.push(flag);
    }
  }
  const missing = REQUIRED_FLAGS.filter((f) => !present.includes(f));
  return { cookieName, present, missing };
}

/** The weak-crypto specialist — plug into the orchestrator alongside the others. */
export const weakCryptoSpecialist: Specialist<WeakCryptoBackend, WeakCryptoReport> = {
  name: "weak-crypto",
  vulnClass: "auth", // as per the roadmap in #23 — no enum churn
  systemPrompt: WEAK_CRYPTO_SYSTEM,
  tools: WEAK_CRYPTO_TOOLS,
  initialPrompt(ctx: SpecialistContext): string {
    return `Audit project ${ctx.projectId} for cookies missing required security flags.`;
  },
  createExecutor(backend: WeakCryptoBackend, ctx: SpecialistContext): SpecialistExecutor<WeakCryptoReport> {
    return new WeakCryptoExecutor(backend, ctx.projectId);
  },
};
