/**
 * Offline verify for the triage layer (#29). Exercises all four actions
 * (keep / downgrade / reclassify / reject) end-to-end with a scripted LLM
 * driver, then asserts:
 *   · applyTriage drops rejected findings entirely
 *   · downgrade sets initialStatus = 'needs_review'
 *   · reclassify mutates vulnClass + severity and preserves the original
 *   · severity upgrades are refused at the tool boundary
 *   · a driver crash returns the untouched report
 *
 * No test target required — triage is a pure post-review pass, no probes.
 *
 * Run: `npm run verify:triage -w @kelp/worker`
 */

import assert from "node:assert/strict";
import {
  applyTriage,
  triageCampaign,
  type AutonomousFinding,
  type CampaignReport,
  type LlmAgentDriver,
  type LlmStep,
  type SpecialistOutcome,
  type TriagedFinding,
} from "@kelp/core";

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

function outcome(name: string, findings: AutonomousFinding[]): SpecialistOutcome {
  return { name, vulnClass: "rls", findings, transcript: [], error: null, steps: 0, usage: null };
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
const conclude = { id: "z", name: "conclude", input: { summary: "" } };

async function main() {
  const outcomes: SpecialistOutcome[] = [
    outcome("agent-data", [
      finding({ fingerprint: "keep-1",       severity: "high" }),
      finding({ fingerprint: "downgrade-1",  severity: "high" }),
      finding({ fingerprint: "reclassify-1", severity: "high", vulnClass: "secret" }),
      finding({ fingerprint: "reject-1",     severity: "low" }),
    ]),
  ];
  const report: CampaignReport = {
    outcomes,
    findings: outcomes.flatMap((o) => o.findings),
    totalUsage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
  };

  // ── 1. Happy path: all four actions ────────────────────────────────────
  const driver = scripted([
    {
      assistantText: "",
      toolCalls: [
        record("a", { index: 0, action: "keep",                        reason: "impact matches evidence" }),
        record("b", { index: 1, action: "downgrade_to_needs_review",  reason: "exploitability needs implausible preconditions" }),
        record("c", {
          index: 2,
          action: "reclassify",
          reclassifyVulnClass: "rls",
          reclassifySeverity: "medium",
          reason: "permissive RLS policy filed as secret",
        }),
        record("d", { index: 3, action: "reject",                     reason: "impact claim is unfalsifiable" }),
      ],
      done: false,
    },
    { assistantText: "", toolCalls: [conclude], done: true },
  ]);
  const res = await triageCampaign(driver, outcomes);
  assert.equal(res.decisions.length, 4, "should record 4 decisions");
  const applied = applyTriage(report, res.decisions);
  assert.equal(applied.findings.length, 3, "reject drops one finding");
  const findings = applied.outcomes[0]!.findings as TriagedFinding[];
  const keep = findings.find((f) => f.fingerprint === "keep-1")!;
  const down = findings.find((f) => f.fingerprint === "downgrade-1")!;
  const recl = findings.find((f) => f.fingerprint === "reclassify-1")!;
  assert.equal(keep.triage?.action, "keep");
  assert.equal(keep.triage?.initialStatus, null);
  assert.equal(down.triage?.initialStatus, "needs_review");
  assert.ok(down.evidence.includes("Kelp triage:"), "downgrade appends reason");
  assert.equal(recl.vulnClass, "rls");
  assert.equal(recl.severity, "medium");
  assert.equal(recl.triage?.originalVulnClass, "secret");
  assert.equal(recl.triage?.originalSeverity, "high");
  assert.equal(applied.findings.find((f: any) => f.fingerprint === "reject-1"), undefined);
  console.log("✓ all four actions applied correctly");

  // ── 2. Severity upgrade refused at the runner ─────────────────────────
  const upgradeOutcomes = [
    outcome("agent-data", [finding({ fingerprint: "u", severity: "low" })]),
  ];
  const upgradeDriver = scripted([
    {
      assistantText: "",
      toolCalls: [
        record("bad", {
          index: 0,
          action: "reclassify",
          reclassifySeverity: "critical",
          reason: "cheating",
        }),
      ],
      done: false,
    },
    { assistantText: "", toolCalls: [conclude], done: true },
  ]);
  const upgradeRes = await triageCampaign(upgradeDriver, upgradeOutcomes);
  assert.equal(upgradeRes.decisions.length, 0, "runner refuses severity upgrades");
  console.log("✓ severity upgrades refused at the tool boundary");

  // ── 3. Crash-isolated ─────────────────────────────────────────────────
  const crashDriver: LlmAgentDriver = {
    start: async () => {
      throw new Error("simulated driver crash");
    },
    provideToolResults: async () => ({ assistantText: "", toolCalls: [], done: true }),
  };
  const crashRes = await triageCampaign(crashDriver, outcomes);
  assert.equal(crashRes.decisions.length, 0, "crash produces no decisions");
  assert.equal(crashRes.usage, null);
  console.log("✓ triage crash isolated — original report survives");

  // ── 4. Empty findings → no LLM call ───────────────────────────────────
  const emptyDriver = scripted([]); // would blow up if start() ran
  const emptyRes = await triageCampaign(emptyDriver, [outcome("agent-data", [])]);
  assert.equal(emptyRes.decisions.length, 0);
  console.log("✓ no findings → no LLM call");

  console.log("\ntriage verify: PASS");
}

main().catch((e) => {
  console.error("triage verify: FAIL");
  console.error(e);
  process.exit(1);
});
