import { test } from "node:test";
import assert from "node:assert/strict";
import type { LlmAgentDriver, LlmStep, ToolResult } from "../loop.js";
import { runCampaignUnsafe, type SpecialistEntry } from "../orchestrator.js";
import type { Specialist } from "../specialist.js";
import { authBypassSpecialist, type AuthBypassBackend } from "./auth-bypass.js";

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

function specialistEntry(driver: LlmAgentDriver, backend: AuthBypassBackend): SpecialistEntry<unknown, unknown> {
  return {
    specialist: authBypassSpecialist as unknown as Specialist<unknown, unknown>,
    backend: backend as unknown,
    driver,
  };
}

// The vulnerable-target scenario: /api/session-lookup honors ?as=<other>.
const vulnerableBackend: AuthBypassBackend = {
  async listEndpoints() {
    return [
      { endpoint: "GET /api/session-lookup" },
      { endpoint: "GET /api/orders/:id" },
    ];
  },
  async probe(_p, endpoint, technique) {
    return {
      bypassed: endpoint.includes("session-lookup") && technique === "query_as_param",
    };
  },
};

const strictBackend: AuthBypassBackend = {
  async listEndpoints() {
    return [{ endpoint: "GET /api/orders/:id" }];
  },
  async probe() {
    return { bypassed: false };
  },
};

test("auth-bypass specialist flags the vulnerable endpoint+technique", async () => {
  const driver = new ScriptedDriver([
    { assistantText: "Listing endpoints.", toolCalls: [{ id: "l", name: "list_endpoints", input: {} }], done: false },
    {
      assistantText: "Probing.",
      toolCalls: [
        { id: "p1", name: "probe_impersonation", input: { endpoint: "GET /api/session-lookup", technique: "query_as_param" } },
        { id: "p2", name: "probe_impersonation", input: { endpoint: "GET /api/orders/:id", technique: "query_as_param" } },
      ],
      done: false,
    },
    {
      assistantText: "Reporting the confirmed one.",
      toolCalls: [{ id: "r", name: "report_finding", input: { endpoint: "GET /api/session-lookup", technique: "query_as_param" } }],
      done: false,
    },
    { assistantText: "Done.", toolCalls: [], done: true },
  ]);
  const report = await runCampaignUnsafe(ctx, { entries: [specialistEntry(driver, vulnerableBackend)] });
  const outcome = report.outcomes[0]!;
  assert.equal(outcome.findings.length, 1);
  const f = outcome.findings[0] as { endpoint: string; technique: string; severity: string; status: string };
  assert.match(f.endpoint, /session-lookup/);
  assert.equal(f.technique, "query_as_param");
  assert.equal(f.severity, "high");
  assert.equal(f.status, "needs_review");
});

test("a strictly-scoped surface yields zero findings (no false positive)", async () => {
  const driver = new ScriptedDriver([
    { assistantText: "", toolCalls: [{ id: "l", name: "list_endpoints", input: {} }], done: false },
    {
      assistantText: "",
      toolCalls: [
        { id: "p", name: "probe_impersonation", input: { endpoint: "GET /api/orders/:id", technique: "query_as_param" } },
      ],
      done: false,
    },
    // Even if the model tries to fabricate, the executor must refuse.
    {
      assistantText: "",
      toolCalls: [{ id: "r", name: "report_finding", input: { endpoint: "GET /api/orders/:id", technique: "query_as_param" } }],
      done: false,
    },
    { assistantText: "", toolCalls: [], done: true },
  ]);
  const report = await runCampaignUnsafe(ctx, { entries: [specialistEntry(driver, strictBackend)] });
  assert.equal(report.outcomes[0]!.findings.length, 0);
});

test("report_finding is rejected without a matching probe (invariant)", async () => {
  // Skip probe entirely — jump to report.
  const driver = new ScriptedDriver([
    {
      assistantText: "",
      toolCalls: [{ id: "r", name: "report_finding", input: { endpoint: "GET /api/session-lookup", technique: "query_as_param" } }],
      done: false,
    },
    { assistantText: "", toolCalls: [], done: true },
  ]);
  const report = await runCampaignUnsafe(ctx, { entries: [specialistEntry(driver, vulnerableBackend)] });
  assert.equal(report.outcomes[0]!.findings.length, 0);
});

test("duplicate report_finding calls produce only one finding", async () => {
  const driver = new ScriptedDriver([
    {
      assistantText: "",
      toolCalls: [{ id: "p", name: "probe_impersonation", input: { endpoint: "GET /api/session-lookup", technique: "query_as_param" } }],
      done: false,
    },
    {
      assistantText: "",
      toolCalls: [
        { id: "r1", name: "report_finding", input: { endpoint: "GET /api/session-lookup", technique: "query_as_param" } },
        { id: "r2", name: "report_finding", input: { endpoint: "GET /api/session-lookup", technique: "query_as_param" } },
      ],
      done: false,
    },
    { assistantText: "", toolCalls: [], done: true },
  ]);
  const report = await runCampaignUnsafe(ctx, { entries: [specialistEntry(driver, vulnerableBackend)] });
  assert.equal(report.outcomes[0]!.findings.length, 1);
});
