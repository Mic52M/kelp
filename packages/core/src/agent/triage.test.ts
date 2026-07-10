import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyTriage,
  summarizeTriage,
  triageCampaign,
  type TriageDecision,
  type TriagedFinding,
} from "./triage.js";
import type { AutonomousFinding } from "./autonomous.js";
import type { LlmAgentDriver, LlmStep } from "./loop.js";
import type { CampaignReport, SpecialistOutcome } from "./orchestrator.js";

function finding(over: Partial<AutonomousFinding> & { fingerprint: string }): AutonomousFinding {
  return {
    vulnClass: "rls",
    severity: "medium",
    title: "Test finding",
    evidence: "the observable held",
    endpoint: "public.users",
    surface: "postgrest",
    fix: "review policy",
    ...over,
  };
}

function outcome(over: Partial<SpecialistOutcome> & { name: string; findings: AutonomousFinding[] }): SpecialistOutcome {
  return {
    vulnClass: "rls",
    transcript: [],
    error: null,
    steps: 0,
    usage: null,
    ...over,
  };
}

function scripted(steps: LlmStep[]): LlmAgentDriver {
  let i = 0;
  return {
    start: async () => steps[i++]!,
    provideToolResults: async () => steps[i++]!,
  };
}

function record(id: string, input: Record<string, unknown>) {
  return { id, name: "record_decision", input };
}
const conclude = (id = "z"): { id: string; name: string; input: Record<string, unknown> } =>
  ({ id, name: "conclude", input: { summary: "" } });

// ─── triageCampaign — the LLM pass ──────────────────────────────────────────

test("empty outcomes → no LLM call, no decisions", async () => {
  const driver = scripted([]); // would throw if start() were called
  const res = await triageCampaign(driver, []);
  assert.deepEqual(res.decisions, []);
  assert.equal(res.usage, null);
});

test("no findings → no LLM call, no decisions", async () => {
  const driver = scripted([]);
  const res = await triageCampaign(driver, [outcome({ name: "agent-data", findings: [] })]);
  assert.deepEqual(res.decisions, []);
});

test("captures keep / downgrade / reclassify / reject decisions", async () => {
  const outcomes: SpecialistOutcome[] = [
    outcome({
      name: "agent-data",
      findings: [
        finding({ fingerprint: "k", severity: "high" }),
        finding({ fingerprint: "d", severity: "high" }),
        finding({ fingerprint: "r", severity: "high", vulnClass: "secret" }),
        finding({ fingerprint: "x", severity: "low" }),
      ],
    }),
  ];
  const driver = scripted([
    {
      assistantText: "",
      toolCalls: [
        record("a", { index: 0, action: "keep", reason: "impact real" }),
        record("b", { index: 1, action: "downgrade_to_needs_review", reason: "impact unclear" }),
        record("c", {
          index: 2,
          action: "reclassify",
          reclassifyVulnClass: "rls",
          reclassifySeverity: "medium",
          reason: "permissive RLS filed as secret",
        }),
        record("d", { index: 3, action: "reject", reason: "unfalsifiable claim" }),
      ],
      done: false,
    },
    { assistantText: "", toolCalls: [conclude()], done: true },
  ]);

  const res = await triageCampaign(driver, outcomes);
  assert.equal(res.decisions.length, 4);
  assert.equal(res.decisions[0]!.action, "keep");
  assert.equal(res.decisions[1]!.action, "downgrade_to_needs_review");
  assert.equal(res.decisions[2]!.action, "reclassify");
  assert.equal(res.decisions[2]!.reclassifyTo?.vulnClass, "rls");
  assert.equal(res.decisions[2]!.reclassifyTo?.severity, "medium");
  assert.equal(res.decisions[3]!.action, "reject");
});

test("severity upgrade is refused at the tool boundary", async () => {
  // The applier is a second defence, but the runner refuses first.
  const outcomes: SpecialistOutcome[] = [
    outcome({
      name: "agent-data",
      findings: [finding({ fingerprint: "u", severity: "low" })],
    }),
  ];
  const driver = scripted([
    {
      assistantText: "",
      toolCalls: [
        record("bad", { index: 0, action: "reclassify", reclassifySeverity: "critical", reason: "want up" }),
      ],
      done: false,
    },
    { assistantText: "", toolCalls: [conclude()], done: true },
  ]);
  const res = await triageCampaign(driver, outcomes);
  assert.equal(res.decisions.length, 0);
});

test("out-of-range index rejected", async () => {
  const outcomes: SpecialistOutcome[] = [
    outcome({ name: "a", findings: [finding({ fingerprint: "f" })] }),
  ];
  const driver = scripted([
    {
      assistantText: "",
      toolCalls: [record("bad", { index: 5, action: "keep", reason: "x" })],
      done: false,
    },
    { assistantText: "", toolCalls: [conclude()], done: true },
  ]);
  const res = await triageCampaign(driver, outcomes);
  assert.equal(res.decisions.length, 0);
});

test("reclassify with neither vulnClass nor severity rejected", async () => {
  const outcomes: SpecialistOutcome[] = [
    outcome({ name: "a", findings: [finding({ fingerprint: "f" })] }),
  ];
  const driver = scripted([
    {
      assistantText: "",
      toolCalls: [record("bad", { index: 0, action: "reclassify", reason: "why" })],
      done: false,
    },
    { assistantText: "", toolCalls: [conclude()], done: true },
  ]);
  const res = await triageCampaign(driver, outcomes);
  assert.equal(res.decisions.length, 0);
});

test("duplicate decisions for the same finding rejected", async () => {
  const outcomes: SpecialistOutcome[] = [
    outcome({ name: "a", findings: [finding({ fingerprint: "f" })] }),
  ];
  const driver = scripted([
    {
      assistantText: "",
      toolCalls: [
        record("1", { index: 0, action: "keep", reason: "ok" }),
        record("2", { index: 0, action: "reject", reason: "nope" }),
      ],
      done: false,
    },
    { assistantText: "", toolCalls: [conclude()], done: true },
  ]);
  const res = await triageCampaign(driver, outcomes);
  assert.equal(res.decisions.length, 1);
  assert.equal(res.decisions[0]!.action, "keep");
});

test("driver crash → empty decisions (isolated)", async () => {
  const driver: LlmAgentDriver = {
    start: async () => {
      throw new Error("boom");
    },
    provideToolResults: async () => ({ assistantText: "", toolCalls: [], done: true }),
  };
  const outcomes: SpecialistOutcome[] = [
    outcome({ name: "a", findings: [finding({ fingerprint: "f" })] }),
  ];
  const res = await triageCampaign(driver, outcomes);
  assert.deepEqual(res.decisions, []);
  assert.equal(res.usage, null);
});

// ─── applyTriage — the deterministic folder ─────────────────────────────────

function report(outcomes: SpecialistOutcome[]): CampaignReport {
  return {
    outcomes,
    findings: outcomes.flatMap((o) => o.findings),
    totalUsage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
  };
}

test("applyTriage: reject drops the finding entirely", () => {
  const r = report([
    outcome({
      name: "a",
      findings: [
        finding({ fingerprint: "keep" }),
        finding({ fingerprint: "drop" }),
      ],
    }),
  ]);
  const decisions: TriageDecision[] = [
    { outcomeIndex: 0, findingIndex: 1, action: "reject", reason: "nonsense" },
  ];
  const next = applyTriage(r, decisions);
  assert.equal(next.outcomes[0]!.findings.length, 1);
  assert.equal((next.outcomes[0]!.findings[0] as AutonomousFinding).fingerprint, "keep");
});

test("applyTriage: downgrade stamps needs_review + appends reason", () => {
  const r = report([outcome({ name: "a", findings: [finding({ fingerprint: "f", evidence: "raw" })] })]);
  const decisions: TriageDecision[] = [
    { outcomeIndex: 0, findingIndex: 0, action: "downgrade_to_needs_review", reason: "impact unclear" },
  ];
  const next = applyTriage(r, decisions);
  const f = next.outcomes[0]!.findings[0] as TriagedFinding;
  assert.equal(f.triage?.action, "downgrade_to_needs_review");
  assert.equal(f.triage?.initialStatus, "needs_review");
  assert.ok(f.evidence.includes("Kelp triage: impact unclear"));
});

test("applyTriage: reclassify mutates vulnClass + severity and preserves original", () => {
  const r = report([
    outcome({
      name: "a",
      findings: [finding({ fingerprint: "f", severity: "high", vulnClass: "secret" })],
    }),
  ]);
  const decisions: TriageDecision[] = [
    {
      outcomeIndex: 0,
      findingIndex: 0,
      action: "reclassify",
      reclassifyTo: { vulnClass: "rls", severity: "medium" },
      reason: "permissive policy",
    },
  ];
  const next = applyTriage(r, decisions);
  const f = next.outcomes[0]!.findings[0] as TriagedFinding;
  assert.equal(f.vulnClass, "rls");
  assert.equal(f.severity, "medium");
  assert.equal(f.triage?.originalVulnClass, "secret");
  assert.equal(f.triage?.originalSeverity, "high");
});

test("applyTriage: never upgrades severity even if decision slips through", () => {
  const r = report([outcome({ name: "a", findings: [finding({ fingerprint: "f", severity: "low" })] })]);
  const decisions: TriageDecision[] = [
    {
      outcomeIndex: 0,
      findingIndex: 0,
      action: "reclassify",
      // Attempted upgrade — defence in depth in the applier.
      reclassifyTo: { severity: "critical" },
      reason: "malformed decision",
    },
  ];
  const next = applyTriage(r, decisions);
  const f = next.outcomes[0]!.findings[0] as TriagedFinding;
  assert.equal(f.severity, "low");
});

test("applyTriage: keep is a no-op on evidence + no triage annotation", () => {
  const r = report([outcome({ name: "a", findings: [finding({ fingerprint: "f", evidence: "raw" })] })]);
  const decisions: TriageDecision[] = [
    { outcomeIndex: 0, findingIndex: 0, action: "keep", reason: "impact real" },
  ];
  const next = applyTriage(r, decisions);
  const f = next.outcomes[0]!.findings[0] as TriagedFinding;
  assert.equal(f.evidence, "raw");
  assert.equal(f.triage?.action, "keep");
  assert.equal(f.triage?.initialStatus, null);
});

test("applyTriage: never fabricates a new finding", () => {
  const r = report([
    outcome({ name: "a", findings: [finding({ fingerprint: "one" }), finding({ fingerprint: "two" })] }),
  ]);
  // Empty decisions — output must match input length exactly.
  const nextEmpty = applyTriage(r, []);
  assert.equal(nextEmpty.outcomes[0]!.findings.length, 2);

  // Every reject reduces count; nothing adds count.
  const decisions: TriageDecision[] = [
    { outcomeIndex: 0, findingIndex: 0, action: "reject", reason: "gone" },
  ];
  const nextRej = applyTriage(r, decisions);
  assert.equal(nextRej.outcomes[0]!.findings.length, 1);
  assert.equal(nextRej.findings.length, 1);
});

test("applyTriage: outcomes and top-level findings stay consistent", () => {
  const r = report([
    outcome({ name: "a", findings: [finding({ fingerprint: "a1" }), finding({ fingerprint: "a2" })] }),
    outcome({ name: "b", findings: [finding({ fingerprint: "b1" })] }),
  ]);
  const decisions: TriageDecision[] = [
    { outcomeIndex: 0, findingIndex: 0, action: "reject", reason: "x" },
    { outcomeIndex: 1, findingIndex: 0, action: "keep", reason: "y" },
  ];
  const next = applyTriage(r, decisions);
  const flatFromOutcomes = next.outcomes.flatMap((o) => o.findings).length;
  assert.equal(next.findings.length, flatFromOutcomes);
  assert.equal(next.findings.length, 2);
});

test("summarizeTriage rolls up counts", () => {
  const s = summarizeTriage([
    { outcomeIndex: 0, findingIndex: 0, action: "keep", reason: "" },
    { outcomeIndex: 0, findingIndex: 1, action: "downgrade_to_needs_review", reason: "" },
    { outcomeIndex: 0, findingIndex: 2, action: "reclassify", reason: "" },
    { outcomeIndex: 0, findingIndex: 3, action: "reject", reason: "" },
    { outcomeIndex: 0, findingIndex: 4, action: "reject", reason: "" },
  ]);
  assert.equal(s, "triage: 1 kept, 1 downgraded, 1 reclassified, 2 rejected");
});
