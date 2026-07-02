import { test } from "node:test";
import assert from "node:assert/strict";
import { runBolaAgent, type BolaProbeBackend } from "./bola.js";
import type { LlmAgentDriver, LlmStep, ToolResult } from "./loop.js";
import { ConsentRequiredError, type ConsentStore, type AuditLogger } from "../consent.js";
import type { ActiveTestConsent } from "../types.js";

// A driver that replays a fixed sequence of model steps, ignoring tool results.
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

// invoices leak across accounts; profiles are properly scoped.
const backend: BolaProbeBackend = {
  async listEndpoints() {
    return [
      { endpoint: "GET /rest/v1/invoices?id=eq.{id}", resourceKind: "invoice", idParameter: "id" },
      { endpoint: "GET /rest/v1/profiles?id=eq.{id}", resourceKind: "profile", idParameter: "id" },
    ];
  },
  async probe(_p, endpoint) {
    return { crossAccountAccess: endpoint.includes("invoices") };
  },
};

const auditNoop: AuditLogger = { record: async () => {} };
const validConsent: ConsentStore = {
  getActiveTestConsent: async (projectId): Promise<ActiveTestConsent> => ({
    projectId,
    orgId: "o1",
    consented: true,
    consentVersion: "v1",
    consentedBy: "u1",
    consentedAt: new Date(),
    revokedAt: null,
  }),
};
const noConsent: ConsentStore = { getActiveTestConsent: async () => null };

const ctx = { orgId: "o1", projectId: "p1", jobId: "job1" };

test("agent probes then reports a confirmed BOLA finding", async () => {
  const driver = new ScriptedDriver([
    { assistantText: "Listing endpoints.", toolCalls: [{ id: "t1", name: "list_endpoints", input: {} }], done: false },
    { assistantText: "Probing invoices.", toolCalls: [{ id: "t2", name: "probe_endpoint", input: { endpoint: "GET /rest/v1/invoices?id=eq.{id}", parameter: "id" } }], done: false },
    { assistantText: "Confirmed — reporting.", toolCalls: [{ id: "t3", name: "report_finding", input: { endpoint: "GET /rest/v1/invoices?id=eq.{id}", parameter: "id", resourceKind: "invoice" } }], done: false },
    { assistantText: "Done.", toolCalls: [], done: true },
  ]);
  const { findings } = await runBolaAgent({ driver, backend, consent: validConsent, audit: auditNoop }, ctx);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.status, "needs_review");
  assert.match(findings[0]!.endpoint, /invoices/);
});

test("a finding NOT confirmed by a probe is rejected (no fabrication)", async () => {
  const driver = new ScriptedDriver([
    // reports without ever probing
    { assistantText: "", toolCalls: [{ id: "t1", name: "report_finding", input: { endpoint: "GET /rest/v1/invoices?id=eq.{id}", parameter: "id", resourceKind: "invoice" } }], done: false },
    { assistantText: "", toolCalls: [], done: true },
  ]);
  const { findings } = await runBolaAgent({ driver, backend, consent: validConsent, audit: auditNoop }, ctx);
  assert.equal(findings.length, 0, "unconfirmed report must not become a finding");
});

test("probing a properly-scoped endpoint yields no finding", async () => {
  const driver = new ScriptedDriver([
    { assistantText: "", toolCalls: [{ id: "t1", name: "probe_endpoint", input: { endpoint: "GET /rest/v1/profiles?id=eq.{id}", parameter: "id" } }], done: false },
    { assistantText: "", toolCalls: [{ id: "t2", name: "report_finding", input: { endpoint: "GET /rest/v1/profiles?id=eq.{id}", parameter: "id", resourceKind: "profile" } }], done: false },
    { assistantText: "", toolCalls: [], done: true },
  ]);
  const { findings } = await runBolaAgent({ driver, backend, consent: validConsent, audit: auditNoop }, ctx);
  assert.equal(findings.length, 0);
});

test("the agentic path is consent-gated too", async () => {
  const driver = new ScriptedDriver([{ assistantText: "", toolCalls: [], done: true }]);
  await assert.rejects(
    () => runBolaAgent({ driver, backend, consent: noConsent, audit: auditNoop }, ctx),
    (e) => e instanceof ConsentRequiredError,
  );
});

test("the step cap prevents an endless loop", async () => {
  // a driver that always asks to probe, never finishes
  const looping: LlmAgentDriver = {
    async start() {
      return { assistantText: "", toolCalls: [{ id: "x", name: "list_endpoints", input: {} }], done: false };
    },
    async provideToolResults() {
      return { assistantText: "", toolCalls: [{ id: "x", name: "list_endpoints", input: {} }], done: false };
    },
  };
  // should terminate (via maxSteps) rather than hang
  const { findings } = await runBolaAgent({ driver: looping, backend, consent: validConsent, audit: auditNoop }, ctx);
  assert.equal(findings.length, 0);
});
