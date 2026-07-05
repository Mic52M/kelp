import { test } from "node:test";
import assert from "node:assert/strict";
import type { LlmAgentDriver, LlmStep, ToolResult } from "../loop.js";
import { runCampaignUnsafe, type SpecialistEntry } from "../orchestrator.js";
import type { Specialist } from "../specialist.js";
import { auditSetCookie, weakCryptoSpecialist, type WeakCryptoBackend } from "./weak-crypto.js";

class ScriptedDriver implements LlmAgentDriver {
  private i = 0;
  constructor(private readonly steps: LlmStep[]) {}
  async start(): Promise<LlmStep> {
    return this.steps[this.i++] ?? { assistantText: "", toolCalls: [], done: true };
  }
  async provideToolResults(_r: ToolResult[]): Promise<LlmStep> {
    return this.steps[this.i++] ?? { assistantText: "", toolCalls: [], done: true };
  }
}

const ctx = { orgId: "o1", projectId: "p1", jobId: "j1" };

function entry(driver: LlmAgentDriver, backend: WeakCryptoBackend): SpecialistEntry<unknown, unknown> {
  return {
    specialist: weakCryptoSpecialist as unknown as Specialist<unknown, unknown>,
    backend: backend as unknown,
    driver,
  };
}

// ─── auditSetCookie: unit correctness ─────────────────────────────────────────

test("auditSetCookie catches a bare cookie missing HttpOnly, Secure and SameSite", () => {
  const r = auditSetCookie("sid=abc123");
  assert.equal(r.cookieName, "sid");
  assert.deepEqual(r.present, []);
  assert.deepEqual(r.missing, ["HttpOnly", "Secure", "SameSite"]);
});

test("auditSetCookie recognises all three flags when present", () => {
  const r = auditSetCookie("sid=abc123; HttpOnly; Secure; SameSite=Strict; Path=/");
  assert.equal(r.cookieName, "sid");
  assert.deepEqual(r.present.sort(), ["HttpOnly", "SameSite", "Secure"]);
  assert.deepEqual(r.missing, []);
});

test("auditSetCookie is case-insensitive on attribute names", () => {
  const r = auditSetCookie("sid=abc123; httponly; SECURE; samesite=lax");
  assert.deepEqual(r.missing, []);
});

test("auditSetCookie flags a partial-set-of-flags cookie", () => {
  const r = auditSetCookie("sid=abc123; HttpOnly");
  assert.deepEqual(r.present, ["HttpOnly"]);
  assert.deepEqual(r.missing.sort(), ["SameSite", "Secure"]);
});

// ─── Executor-level tests via the orchestrator ────────────────────────────────

const vulnerableBackend: WeakCryptoBackend = {
  async listEndpointsSettingCookies() {
    return [
      { endpoint: "/api/set-insecure-cookie" },
      { endpoint: "/api/set-secure-cookie" },
    ];
  },
  async probeCookieFlags(_p, endpoint) {
    if (endpoint.includes("insecure")) {
      return { cookieName: "sid", present: [], missing: ["HttpOnly", "Secure", "SameSite"] };
    }
    return { cookieName: "sid", present: ["HttpOnly", "Secure", "SameSite"], missing: [] };
  },
};

const cleanBackend: WeakCryptoBackend = {
  async listEndpointsSettingCookies() {
    return [{ endpoint: "/api/set-secure-cookie" }];
  },
  async probeCookieFlags() {
    return { cookieName: "sid", present: ["HttpOnly", "Secure", "SameSite"], missing: [] };
  },
};

test("weak-crypto specialist flags the endpoint with missing cookie flags", async () => {
  const driver = new ScriptedDriver([
    { assistantText: "Listing.", toolCalls: [{ id: "l", name: "list_endpoints", input: {} }], done: false },
    {
      assistantText: "Probing both.",
      toolCalls: [
        { id: "p1", name: "probe_cookie_flags", input: { endpoint: "/api/set-insecure-cookie" } },
        { id: "p2", name: "probe_cookie_flags", input: { endpoint: "/api/set-secure-cookie" } },
      ],
      done: false,
    },
    {
      assistantText: "Reporting the confirmed one.",
      toolCalls: [{ id: "r", name: "report_finding", input: { endpoint: "/api/set-insecure-cookie" } }],
      done: false,
    },
    { assistantText: "Done.", toolCalls: [], done: true },
  ]);
  const report = await runCampaignUnsafe(ctx, { entries: [entry(driver, vulnerableBackend)] });
  const outcome = report.outcomes[0]!;
  assert.equal(outcome.findings.length, 1);
  const f = outcome.findings[0] as { endpoint: string; cookieName: string; missingFlags: string[]; severity: string; status: string };
  assert.match(f.endpoint, /insecure/);
  assert.equal(f.cookieName, "sid");
  assert.deepEqual(f.missingFlags.sort(), ["HttpOnly", "SameSite", "Secure"]);
  assert.equal(f.severity, "medium");
  assert.equal(f.status, "needs_review");
});

test("all-flags-present cookies yield zero findings (no false positive)", async () => {
  const driver = new ScriptedDriver([
    { assistantText: "", toolCalls: [{ id: "l", name: "list_endpoints", input: {} }], done: false },
    { assistantText: "", toolCalls: [{ id: "p", name: "probe_cookie_flags", input: { endpoint: "/api/set-secure-cookie" } }], done: false },
    // Model tries to fabricate; executor must refuse.
    { assistantText: "", toolCalls: [{ id: "r", name: "report_finding", input: { endpoint: "/api/set-secure-cookie" } }], done: false },
    { assistantText: "", toolCalls: [], done: true },
  ]);
  const report = await runCampaignUnsafe(ctx, { entries: [entry(driver, cleanBackend)] });
  assert.equal(report.outcomes[0]!.findings.length, 0);
});

test("report_finding is rejected without a matching probe (invariant)", async () => {
  const driver = new ScriptedDriver([
    { assistantText: "", toolCalls: [{ id: "r", name: "report_finding", input: { endpoint: "/api/set-insecure-cookie" } }], done: false },
    { assistantText: "", toolCalls: [], done: true },
  ]);
  const report = await runCampaignUnsafe(ctx, { entries: [entry(driver, vulnerableBackend)] });
  assert.equal(report.outcomes[0]!.findings.length, 0);
});
