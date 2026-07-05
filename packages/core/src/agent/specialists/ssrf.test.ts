import { test } from "node:test";
import assert from "node:assert/strict";
import type { LlmAgentDriver, LlmStep, ToolResult } from "../loop.js";
import { runCampaignUnsafe, type SpecialistEntry } from "../orchestrator.js";
import type { Specialist } from "../specialist.js";
import { ssrfSpecialist, type SsrfBackend } from "./ssrf.js";

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

function entry(driver: LlmAgentDriver, backend: SsrfBackend): SpecialistEntry<unknown, unknown> {
  return {
    specialist: ssrfSpecialist as unknown as Specialist<unknown, unknown>,
    backend: backend as unknown,
    driver,
  };
}

// Vulnerable backend: /api/fetch fires the callback for any technique;
// /api/fetch-safe honours an allowlist and never fires.
const vulnerableBackend: SsrfBackend = {
  async listEndpoints() {
    return [
      { endpoint: "GET /api/fetch", parameter: "url" },
      { endpoint: "GET /api/fetch-safe", parameter: "url" },
    ];
  },
  async probe(_p, endpoint) {
    return { bypassed: endpoint.includes("/api/fetch") && !endpoint.includes("safe") };
  },
};

const strictBackend: SsrfBackend = {
  async listEndpoints() {
    return [{ endpoint: "GET /api/fetch-safe", parameter: "url" }];
  },
  async probe() {
    return { bypassed: false };
  },
};

test("ssrf specialist flags the vulnerable endpoint+technique", async () => {
  const driver = new ScriptedDriver([
    { assistantText: "Listing.", toolCalls: [{ id: "l", name: "list_endpoints", input: {} }], done: false },
    {
      assistantText: "Probing both endpoints with plain_http.",
      toolCalls: [
        { id: "p1", name: "probe_ssrf", input: { endpoint: "GET /api/fetch", parameter: "url", technique: "plain_http" } },
        { id: "p2", name: "probe_ssrf", input: { endpoint: "GET /api/fetch-safe", parameter: "url", technique: "plain_http" } },
      ],
      done: false,
    },
    {
      assistantText: "Reporting the confirmed one.",
      toolCalls: [{ id: "r", name: "report_finding", input: { endpoint: "GET /api/fetch", parameter: "url", technique: "plain_http" } }],
      done: false,
    },
    { assistantText: "Done.", toolCalls: [], done: true },
  ]);
  const report = await runCampaignUnsafe(ctx, { entries: [entry(driver, vulnerableBackend)] });
  const outcome = report.outcomes[0]!;
  assert.equal(outcome.findings.length, 1);
  const f = outcome.findings[0] as { endpoint: string; parameter: string; technique: string; severity: string; status: string };
  assert.match(f.endpoint, /\/api\/fetch$/);
  assert.equal(f.parameter, "url");
  assert.equal(f.technique, "plain_http");
  assert.equal(f.severity, "high");
  assert.equal(f.status, "needs_review");
});

test("a properly-allowlisted surface yields zero findings (no false positive)", async () => {
  const driver = new ScriptedDriver([
    { assistantText: "", toolCalls: [{ id: "l", name: "list_endpoints", input: {} }], done: false },
    {
      assistantText: "",
      toolCalls: [
        { id: "p", name: "probe_ssrf", input: { endpoint: "GET /api/fetch-safe", parameter: "url", technique: "loopback_127" } },
      ],
      done: false,
    },
    // Model tries to fabricate; executor must refuse.
    {
      assistantText: "",
      toolCalls: [{ id: "r", name: "report_finding", input: { endpoint: "GET /api/fetch-safe", parameter: "url", technique: "loopback_127" } }],
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
      toolCalls: [{ id: "r", name: "report_finding", input: { endpoint: "GET /api/fetch", parameter: "url", technique: "plain_http" } }],
      done: false,
    },
    { assistantText: "", toolCalls: [], done: true },
  ]);
  const report = await runCampaignUnsafe(ctx, { entries: [entry(driver, vulnerableBackend)] });
  assert.equal(report.outcomes[0]!.findings.length, 0);
});

test("report_finding is rejected if the confirmed probe used a different technique", async () => {
  // Backend confirms plain_http but the model tries to report loopback_127.
  const driver = new ScriptedDriver([
    {
      assistantText: "",
      toolCalls: [{ id: "p", name: "probe_ssrf", input: { endpoint: "GET /api/fetch", parameter: "url", technique: "plain_http" } }],
      done: false,
    },
    {
      assistantText: "",
      toolCalls: [{ id: "r", name: "report_finding", input: { endpoint: "GET /api/fetch", parameter: "url", technique: "loopback_127" } }],
      done: false,
    },
    { assistantText: "", toolCalls: [], done: true },
  ]);
  const report = await runCampaignUnsafe(ctx, { entries: [entry(driver, vulnerableBackend)] });
  assert.equal(report.outcomes[0]!.findings.length, 0, "the technique dimension is part of the invariant key");
});
