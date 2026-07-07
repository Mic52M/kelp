import { test } from "node:test";
import assert from "node:assert/strict";
import { ConsentRequiredError, type ConsentStore, type AuditLogger } from "../consent.js";
import type { ActiveTestConsent } from "../types.js";
import type {
  AgentTool,
  LlmAgentDriver,
  LlmStep,
  LlmUsage,
  ToolCall,
  ToolResult,
} from "./loop.js";
import { runActivePentest, runCampaignUnsafe, type SpecialistEntry } from "./orchestrator.js";
import type { Specialist, SpecialistContext, SpecialistExecutor } from "./specialist.js";

// ─── Test fixtures ────────────────────────────────────────────────────────────

/** Driver that replays a fixed sequence of steps. */
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

// A tiny specialist whose executor implements the same "no unconfirmed findings"
// invariant BOLA does — different tools, different finding shape, so we prove
// the framework is truly class-agnostic.
type TinyBackend = { probe(input: string): Promise<boolean> };
type TinyFinding = { kind: string; input: string };

function makeTiny(name: string, vulnClass: "bola" | "rls" | "secret" = "bola"): Specialist<TinyBackend, TinyFinding> {
  const tools: AgentTool[] = [
    { name: "probe", description: "probe", inputSchema: { type: "object", properties: { input: { type: "string" } }, required: ["input"] } },
    { name: "report", description: "report", inputSchema: { type: "object", properties: { input: { type: "string" } }, required: ["input"] } },
  ];
  return {
    name,
    vulnClass,
    systemPrompt: `system ${name}`,
    tools,
    initialPrompt: (ctx) => `run ${name} on ${ctx.projectId}`,
    createExecutor(backend: TinyBackend): SpecialistExecutor<TinyFinding> {
      const confirmed = new Set<string>();
      const findings: TinyFinding[] = [];
      return {
        findings,
        async execute(call: ToolCall): Promise<ToolResult> {
          const input = String(call.input.input ?? "");
          if (call.name === "probe") {
            const ok = await backend.probe(input);
            if (ok) confirmed.add(input);
            return { toolCallId: call.id, content: ok ? "ok" : "denied" };
          }
          if (call.name === "report") {
            if (!confirmed.has(input)) {
              return { toolCallId: call.id, isError: true, content: "rejected — probe first" };
            }
            findings.push({ kind: name, input });
            return { toolCallId: call.id, content: "recorded" };
          }
          return { toolCallId: call.id, isError: true, content: "unknown tool" };
        },
      };
    },
  };
}

function scriptProbeAndReport(input: string): LlmStep[] {
  return [
    { assistantText: "", toolCalls: [{ id: "1", name: "probe", input: { input } }], done: false },
    { assistantText: "", toolCalls: [{ id: "2", name: "report", input: { input } }], done: false },
    { assistantText: "", toolCalls: [], done: true },
  ];
}

const auditNoop: AuditLogger = { record: async () => {} };
const validConsent: ConsentStore = {
  getActiveTestConsent: async (projectId): Promise<ActiveTestConsent> => ({
    projectId,
    orgId: "o1",
    consented: true,
    consentVersion: "v3",
    consentedBy: "u1",
    consentedAt: new Date(),
    revokedAt: null,
  }),
};
const noConsent: ConsentStore = { getActiveTestConsent: async () => null };
const ctx: SpecialistContext = { orgId: "o1", projectId: "p1", jobId: "j1" };

const alwaysYes: TinyBackend = { probe: async () => true };
const alwaysNo: TinyBackend = { probe: async () => false };

// ─── Tests ────────────────────────────────────────────────────────────────────

test("orchestrator dispatches multiple specialists and aggregates findings", async () => {
  const entries: SpecialistEntry<unknown, unknown>[] = [
    { specialist: makeTiny("a") as unknown as Specialist<unknown, unknown>, backend: alwaysYes, driver: new ScriptedDriver(scriptProbeAndReport("t1")) },
    { specialist: makeTiny("b") as unknown as Specialist<unknown, unknown>, backend: alwaysYes, driver: new ScriptedDriver(scriptProbeAndReport("t2")) },
    { specialist: makeTiny("c") as unknown as Specialist<unknown, unknown>, backend: alwaysYes, driver: new ScriptedDriver(scriptProbeAndReport("t3")) },
  ];
  const report = await runActivePentest({ consent: validConsent, audit: auditNoop }, ctx, { entries });
  assert.equal(report.outcomes.length, 3);
  assert.deepEqual(report.outcomes.map((o) => o.name), ["a", "b", "c"]);
  assert.equal(report.findings.length, 3);
});

test("a specialist that finds nothing produces zero findings (not a crash)", async () => {
  const entries: SpecialistEntry<unknown, unknown>[] = [
    { specialist: makeTiny("clean") as unknown as Specialist<unknown, unknown>, backend: alwaysNo, driver: new ScriptedDriver(scriptProbeAndReport("t1")) },
  ];
  const report = await runActivePentest({ consent: validConsent, audit: auditNoop }, ctx, { entries });
  assert.equal(report.outcomes[0]!.error, null);
  assert.equal(report.findings.length, 0);
});

test("unconfirmed report tool call cannot produce a finding (invariant)", async () => {
  // Skip the probe entirely — go straight to report. The executor must refuse.
  const report = await runActivePentest({ consent: validConsent, audit: auditNoop }, ctx, {
    entries: [
      {
        specialist: makeTiny("cheat") as unknown as Specialist<unknown, unknown>,
        backend: alwaysYes,
        driver: new ScriptedDriver([
          { assistantText: "", toolCalls: [{ id: "1", name: "report", input: { input: "t1" } }], done: false },
          { assistantText: "", toolCalls: [], done: true },
        ]),
      },
    ],
  });
  assert.equal(report.findings.length, 0, "unconfirmed report must not create a finding");
});

test("one specialist crashing does not fail the campaign", async () => {
  const explodingDriver: LlmAgentDriver = {
    async start() { throw new Error("driver blew up"); },
    async provideToolResults() { throw new Error("unreachable"); },
  };
  const entries: SpecialistEntry<unknown, unknown>[] = [
    { specialist: makeTiny("good") as unknown as Specialist<unknown, unknown>, backend: alwaysYes, driver: new ScriptedDriver(scriptProbeAndReport("t1")) },
    { specialist: makeTiny("bad") as unknown as Specialist<unknown, unknown>, backend: alwaysYes, driver: explodingDriver },
  ];
  const report = await runActivePentest({ consent: validConsent, audit: auditNoop }, ctx, { entries });
  assert.equal(report.outcomes.length, 2);
  assert.equal(report.outcomes[0]!.error, null);
  assert.match(report.outcomes[1]!.error ?? "", /blew up/);
  // The good specialist's finding is still there.
  assert.equal(report.findings.length, 1);
});

test("the whole campaign is consent-gated (no consent → ConsentRequiredError)", async () => {
  await assert.rejects(
    () =>
      runActivePentest({ consent: noConsent, audit: auditNoop }, ctx, {
        entries: [
          {
            specialist: makeTiny("a") as unknown as Specialist<unknown, unknown>,
            backend: alwaysYes,
            driver: new ScriptedDriver(scriptProbeAndReport("t1")),
          },
        ],
      }),
    (e) => e instanceof ConsentRequiredError,
  );
});

test("maxParallel bounds concurrent specialists", async () => {
  // Instrument backends to record concurrent activity — if maxParallel=1 the
  // second specialist must wait for the first to finish before its probe runs.
  let concurrent = 0;
  let maxSeen = 0;
  function slowBackend(): TinyBackend {
    return {
      async probe() {
        concurrent++;
        maxSeen = Math.max(maxSeen, concurrent);
        await new Promise((r) => setTimeout(r, 20));
        concurrent--;
        return true;
      },
    };
  }
  const entries: SpecialistEntry<unknown, unknown>[] = [
    { specialist: makeTiny("a") as unknown as Specialist<unknown, unknown>, backend: slowBackend(), driver: new ScriptedDriver(scriptProbeAndReport("t1")) },
    { specialist: makeTiny("b") as unknown as Specialist<unknown, unknown>, backend: slowBackend(), driver: new ScriptedDriver(scriptProbeAndReport("t2")) },
    { specialist: makeTiny("c") as unknown as Specialist<unknown, unknown>, backend: slowBackend(), driver: new ScriptedDriver(scriptProbeAndReport("t3")) },
  ];
  await runCampaignUnsafe(ctx, { entries, maxParallel: 1 });
  assert.equal(maxSeen, 1);
});

test("driver.getUsage() is threaded into SpecialistOutcome.usage + campaign totalUsage (#25)", async () => {
  // Wrap the scripted driver with a getUsage() that pretends 1000/2000 haiku tokens.
  class MeteredDriver implements LlmAgentDriver {
    private inner: ScriptedDriver;
    constructor(steps: LlmStep[]) { this.inner = new ScriptedDriver(steps); }
    start(opts: { system: string; tools: AgentTool[]; prompt: string }) { return this.inner.start(); }
    provideToolResults(r: ToolResult[]) { return this.inner.provideToolResults(r); }
    getUsage(): LlmUsage { return { inputTokens: 1000, outputTokens: 2000, model: "claude-haiku-4-5" }; }
  }
  const entries: SpecialistEntry<unknown, unknown>[] = [
    { specialist: makeTiny("a") as unknown as Specialist<unknown, unknown>, backend: alwaysYes, driver: new MeteredDriver(scriptProbeAndReport("t1")) },
    { specialist: makeTiny("b") as unknown as Specialist<unknown, unknown>, backend: alwaysYes, driver: new ScriptedDriver(scriptProbeAndReport("t2")) },
  ];
  const report = await runActivePentest({ consent: validConsent, audit: auditNoop }, ctx, { entries });
  // Metered specialist populated usage; scripted specialist reports null.
  assert.deepEqual(report.outcomes[0]!.usage, {
    inputTokens: 1000,
    outputTokens: 2000,
    // haiku-4-5: $1/Mtok in + $5/Mtok out => 1000*1e-6 + 2000*5e-6 = $0.011
    estimatedCostUsd: 0.011,
  });
  assert.equal(report.outcomes[1]!.usage, null);
  // Campaign total is the sum across specialists that reported usage.
  assert.equal(report.totalUsage.inputTokens, 1000);
  assert.equal(report.totalUsage.outputTokens, 2000);
  assert.equal(Math.round(report.totalUsage.estimatedCostUsd * 1000) / 1000, 0.011);
});

test("outcomes preserve the caller-provided specialist order even when run concurrently", async () => {
  // b resolves faster than a, but the outcome list must still be a, b.
  const fastBackend: TinyBackend = { probe: async () => true };
  const slowBackend: TinyBackend = {
    async probe() {
      await new Promise((r) => setTimeout(r, 30));
      return true;
    },
  };
  const entries: SpecialistEntry<unknown, unknown>[] = [
    { specialist: makeTiny("a") as unknown as Specialist<unknown, unknown>, backend: slowBackend, driver: new ScriptedDriver(scriptProbeAndReport("t1")) },
    { specialist: makeTiny("b") as unknown as Specialist<unknown, unknown>, backend: fastBackend, driver: new ScriptedDriver(scriptProbeAndReport("t2")) },
  ];
  const report = await runCampaignUnsafe(ctx, { entries });
  assert.deepEqual(report.outcomes.map((o) => o.name), ["a", "b"]);
});
