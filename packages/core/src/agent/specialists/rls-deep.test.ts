import { test } from "node:test";
import assert from "node:assert/strict";
import type { LlmAgentDriver, LlmStep, ToolResult } from "../loop.js";
import { runCampaignUnsafe, type SpecialistEntry } from "../orchestrator.js";
import type { Specialist } from "../specialist.js";
import { rlsDeepSpecialist, type RlsDeepBackend } from "./rls-deep.js";

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

function entry(driver: LlmAgentDriver, backend: RlsDeepBackend): SpecialistEntry<unknown, unknown> {
  return {
    specialist: rlsDeepSpecialist as unknown as Specialist<unknown, unknown>,
    backend: backend as unknown,
    driver,
  };
}

const mixedBackend: RlsDeepBackend = {
  async listTables() {
    return [{ table: "orders_public" }, { table: "orders_scoped" }];
  },
  async probeCrossAccountRead(_p, table) {
    return { crossAccountAccess: table === "orders_public" };
  },
};

const strictBackend: RlsDeepBackend = {
  async listTables() {
    return [{ table: "orders_scoped" }];
  },
  async probeCrossAccountRead() {
    return { crossAccountAccess: false };
  },
};

test("rls-deep specialist flags the RLS-off table", async () => {
  const driver = new ScriptedDriver([
    { assistantText: "Listing.", toolCalls: [{ id: "l", name: "list_tables", input: {} }], done: false },
    {
      assistantText: "Probing each table.",
      toolCalls: [
        { id: "p1", name: "probe_cross_account_read", input: { table: "orders_public" } },
        { id: "p2", name: "probe_cross_account_read", input: { table: "orders_scoped" } },
      ],
      done: false,
    },
    {
      assistantText: "Reporting the confirmed leak.",
      toolCalls: [{ id: "r", name: "report_finding", input: { table: "orders_public" } }],
      done: false,
    },
    { assistantText: "Done.", toolCalls: [], done: true },
  ]);
  const report = await runCampaignUnsafe(ctx, { entries: [entry(driver, mixedBackend)] });
  const outcome = report.outcomes[0]!;
  assert.equal(outcome.findings.length, 1);
  const f = outcome.findings[0] as { table: string; severity: string; status: string };
  assert.equal(f.table, "orders_public");
  assert.equal(f.severity, "high");
  assert.equal(f.status, "needs_review");
});

test("a properly-scoped table yields zero findings (no false positive)", async () => {
  const driver = new ScriptedDriver([
    { assistantText: "", toolCalls: [{ id: "l", name: "list_tables", input: {} }], done: false },
    { assistantText: "", toolCalls: [{ id: "p", name: "probe_cross_account_read", input: { table: "orders_scoped" } }], done: false },
    // Model tries to fabricate; executor refuses.
    { assistantText: "", toolCalls: [{ id: "r", name: "report_finding", input: { table: "orders_scoped" } }], done: false },
    { assistantText: "", toolCalls: [], done: true },
  ]);
  const report = await runCampaignUnsafe(ctx, { entries: [entry(driver, strictBackend)] });
  assert.equal(report.outcomes[0]!.findings.length, 0);
});

test("report_finding is rejected without a matching probe (invariant)", async () => {
  const driver = new ScriptedDriver([
    { assistantText: "", toolCalls: [{ id: "r", name: "report_finding", input: { table: "orders_public" } }], done: false },
    { assistantText: "", toolCalls: [], done: true },
  ]);
  const report = await runCampaignUnsafe(ctx, { entries: [entry(driver, mixedBackend)] });
  assert.equal(report.outcomes[0]!.findings.length, 0);
});

test("all five specialists coexist under the orchestrator without collisions", async () => {
  // Smoke test: three shipped-earlier + exposure + rls-deep run together
  // and each keeps its own invariant map. All no-op drivers → zero findings.
  const { bolaSpecialist } = await import("./bola.js");
  const { authBypassSpecialist } = await import("./auth-bypass.js");
  const { injectionSpecialist } = await import("./injection.js");
  const { ssrfSpecialist } = await import("./ssrf.js");
  const { exposureSpecialist } = await import("./exposure.js");
  const noop: LlmAgentDriver = {
    async start() { return { assistantText: "", toolCalls: [], done: true }; },
    async provideToolResults() { return { assistantText: "", toolCalls: [], done: true }; },
  };
  const noopBackend = { async listTables() { return []; }, async probeCrossAccountRead() { return { crossAccountAccess: false }; } };
  const bolaBe = { async listEndpoints() { return []; }, async probe() { return { crossAccountAccess: false }; } };
  const authBe = { async listEndpoints() { return []; }, async probe() { return { bypassed: false }; } };
  const injBe = { async listEndpoints() { return []; }, async probe() { return { bypassed: false }; } };
  const ssrfBe = { async listEndpoints() { return []; }, async probe() { return { bypassed: false }; } };
  const expBe = { async listEndpoints() { return []; }, async probeResponseShape() { return { fieldNames: [] }; } };
  const report = await runCampaignUnsafe(ctx, {
    entries: [
      { specialist: bolaSpecialist as unknown as Specialist<unknown, unknown>, backend: bolaBe as unknown, driver: noop },
      { specialist: authBypassSpecialist as unknown as Specialist<unknown, unknown>, backend: authBe as unknown, driver: noop },
      { specialist: injectionSpecialist as unknown as Specialist<unknown, unknown>, backend: injBe as unknown, driver: noop },
      { specialist: ssrfSpecialist as unknown as Specialist<unknown, unknown>, backend: ssrfBe as unknown, driver: noop },
      { specialist: exposureSpecialist as unknown as Specialist<unknown, unknown>, backend: expBe as unknown, driver: noop },
      { specialist: rlsDeepSpecialist as unknown as Specialist<unknown, unknown>, backend: noopBackend as unknown, driver: noop },
    ],
  });
  assert.equal(report.outcomes.length, 6);
  assert.deepEqual(report.outcomes.map((o) => o.name), ["bola", "auth-bypass", "injection", "ssrf", "exposure", "rls-deep"]);
  assert.equal(report.findings.length, 0);
});
