import { test } from "node:test";
import assert from "node:assert/strict";
import type { LlmAgentDriver, LlmStep, ToolResult } from "../loop.js";
import { runCampaignUnsafe, type SpecialistEntry } from "../orchestrator.js";
import type { Specialist } from "../specialist.js";
import { injectionSpecialist, type InjectionBackend } from "./injection.js";

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

function entry(driver: LlmAgentDriver, backend: InjectionBackend): SpecialistEntry<unknown, unknown> {
  return {
    specialist: injectionSpecialist as unknown as Specialist<unknown, unknown>,
    backend: backend as unknown,
    driver,
  };
}

const vulnerableBackend: InjectionBackend = {
  async listEndpoints() {
    return [
      { endpoint: "GET /api/orders/search", parameter: "q" },
      { endpoint: "GET /api/orders/find", parameter: "q" },
    ];
  },
  async probe(_p, endpoint) {
    return endpoint.includes("/search")
      ? { bypassed: true, payloadFamily: "sql_or_true" }
      : { bypassed: false };
  },
};

const strictBackend: InjectionBackend = {
  async listEndpoints() {
    return [{ endpoint: "GET /api/orders/find", parameter: "q" }];
  },
  async probe() {
    return { bypassed: false };
  },
};

test("injection specialist flags the vulnerable endpoint+parameter", async () => {
  const driver = new ScriptedDriver([
    { assistantText: "Listing.", toolCalls: [{ id: "l", name: "list_endpoints", input: {} }], done: false },
    {
      assistantText: "Probing both.",
      toolCalls: [
        { id: "p1", name: "probe_injection", input: { endpoint: "GET /api/orders/search", parameter: "q" } },
        { id: "p2", name: "probe_injection", input: { endpoint: "GET /api/orders/find", parameter: "q" } },
      ],
      done: false,
    },
    {
      assistantText: "Reporting the confirmed one.",
      toolCalls: [{ id: "r", name: "report_finding", input: { endpoint: "GET /api/orders/search", parameter: "q" } }],
      done: false,
    },
    { assistantText: "Done.", toolCalls: [], done: true },
  ]);
  const report = await runCampaignUnsafe(ctx, { entries: [entry(driver, vulnerableBackend)] });
  const outcome = report.outcomes[0]!;
  assert.equal(outcome.findings.length, 1);
  const f = outcome.findings[0] as { endpoint: string; parameter: string; payloadFamily: string; severity: string; status: string };
  assert.match(f.endpoint, /\/search/);
  assert.equal(f.parameter, "q");
  assert.equal(f.payloadFamily, "sql_or_true");
  assert.equal(f.severity, "critical");
  assert.equal(f.status, "needs_review");
});

test("a properly-parameterised surface yields zero findings (no false positive)", async () => {
  const driver = new ScriptedDriver([
    { assistantText: "", toolCalls: [{ id: "l", name: "list_endpoints", input: {} }], done: false },
    {
      assistantText: "",
      toolCalls: [{ id: "p", name: "probe_injection", input: { endpoint: "GET /api/orders/find", parameter: "q" } }],
      done: false,
    },
    // Model tries to fabricate; executor must refuse.
    {
      assistantText: "",
      toolCalls: [{ id: "r", name: "report_finding", input: { endpoint: "GET /api/orders/find", parameter: "q" } }],
      done: false,
    },
    { assistantText: "", toolCalls: [], done: true },
  ]);
  const report = await runCampaignUnsafe(ctx, { entries: [entry(driver, strictBackend)] });
  assert.equal(report.outcomes[0]!.findings.length, 0);
});

test("report_finding is rejected without a matching probe (invariant)", async () => {
  const driver = new ScriptedDriver([
    {
      assistantText: "",
      toolCalls: [{ id: "r", name: "report_finding", input: { endpoint: "GET /api/orders/search", parameter: "q" } }],
      done: false,
    },
    { assistantText: "", toolCalls: [], done: true },
  ]);
  const report = await runCampaignUnsafe(ctx, { entries: [entry(driver, vulnerableBackend)] });
  assert.equal(report.outcomes[0]!.findings.length, 0);
});

test("all three specialists run in one campaign and each keeps its invariant", async () => {
  // Not exhaustive — a smoke test that BOLA + auth-bypass + injection coexist
  // in the orchestrator without stepping on each other.
  const { bolaSpecialist } = await import("./bola.js");
  const { authBypassSpecialist } = await import("./auth-bypass.js");
  const bolaBackend = {
    async listEndpoints() { return [{ endpoint: "GET /x", resourceKind: "x", idParameter: "id" }]; },
    async probe() { return { crossAccountAccess: false }; },
  };
  const authBackend = {
    async listEndpoints() { return [{ endpoint: "GET /y" }]; },
    async probe() { return { bypassed: false }; },
  };
  const noOpDriver: LlmAgentDriver = {
    async start() { return { assistantText: "", toolCalls: [], done: true }; },
    async provideToolResults() { return { assistantText: "", toolCalls: [], done: true }; },
  };
  const report = await runCampaignUnsafe(ctx, {
    entries: [
      { specialist: bolaSpecialist as unknown as Specialist<unknown, unknown>, backend: bolaBackend as unknown, driver: noOpDriver },
      { specialist: authBypassSpecialist as unknown as Specialist<unknown, unknown>, backend: authBackend as unknown, driver: noOpDriver },
      { specialist: injectionSpecialist as unknown as Specialist<unknown, unknown>, backend: strictBackend as unknown, driver: noOpDriver },
    ],
  });
  assert.equal(report.outcomes.length, 3);
  assert.deepEqual(report.outcomes.map((o) => o.name), ["bola", "auth-bypass", "injection"]);
  assert.equal(report.findings.length, 0);
});
