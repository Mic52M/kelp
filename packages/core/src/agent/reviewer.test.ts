import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewCampaign } from "./reviewer.js";
import type { LlmAgentDriver, LlmStep } from "./loop.js";
import type { SpecialistOutcome } from "./orchestrator.js";

function outcome(over: Partial<SpecialistOutcome> & { name: string }): SpecialistOutcome {
  return {
    vulnClass: "rls",
    findings: [], transcript: [], error: null, steps: 0, usage: null,
    ...over,
  };
}

/** Scripted driver: replays a fixed sequence of LlmStep responses. */
function scripted(steps: LlmStep[]): LlmAgentDriver {
  let i = 0;
  return {
    start: async () => steps[i++]!,
    provideToolResults: async () => steps[i++]!,
  };
}

test("captures spawn_followup tool calls as leads", async () => {
  const outcomes: SpecialistOutcome[] = [
    outcome({ name: "agent-edge", steps: 28, transcript: ["step 0", "step 1"] }),
  ];
  const driver = scripted([
    {
      assistantText: "found one lead",
      toolCalls: [
        {
          id: "c1",
          name: "spawn_followup",
          input: {
            fromAgent: "agent-edge",
            step: 22,
            hypothesis: "user_roles cross-read",
            surface: "postgrest",
            target: "user_roles",
            whyMissed: "ran out of steps",
          },
        },
      ],
      done: false,
    },
    { assistantText: "done", toolCalls: [{ id: "c2", name: "conclude", input: { summary: "1 lead" } }], done: true },
  ]);
  const leads = await reviewCampaign(driver, outcomes);
  assert.equal(leads.length, 1);
  assert.equal(leads[0]!.fromAgent, "agent-edge");
  assert.equal(leads[0]!.surface, "postgrest");
  assert.equal(leads[0]!.target, "user_roles");
});

test("empty leads on a clean review (conclude only)", async () => {
  const driver = scripted([
    { assistantText: "nothing worth chasing", toolCalls: [{ id: "c1", name: "conclude", input: { summary: "" } }], done: true },
  ]);
  const leads = await reviewCampaign(driver, [outcome({ name: "agent-data" })]);
  assert.equal(leads.length, 0);
});

test("cap of 3 leads even if the model queues more", async () => {
  const call = (id: string, target: string) => ({
    id, name: "spawn_followup",
    input: {
      fromAgent: "agent-data", step: 5,
      hypothesis: `hyp ${target}`, surface: "postgrest",
      target, whyMissed: "misread 204",
    },
  });
  const driver = scripted([
    {
      assistantText: "",
      toolCalls: [call("a", "t1"), call("b", "t2"), call("c", "t3"), call("d", "t4")],
      done: false,
    },
    { assistantText: "", toolCalls: [{ id: "e", name: "conclude", input: { summary: "" } }], done: true },
  ]);
  const leads = await reviewCampaign(driver, [outcome({ name: "agent-data" })]);
  assert.equal(leads.length, 3);
});

test("driver throwing returns [] — never blows up the campaign", async () => {
  const boom: LlmAgentDriver = {
    start: async () => { throw new Error("anthropic down"); },
    provideToolResults: async () => { throw new Error("unreachable"); },
  };
  const leads = await reviewCampaign(boom, [outcome({ name: "agent-data" })]);
  assert.deepEqual(leads, []);
});

test("dedupes identical leads by surface + target + hypothesis prefix", async () => {
  const same = (id: string) => ({
    id, name: "spawn_followup",
    input: {
      fromAgent: "agent-data", step: 5,
      hypothesis: "user_roles leaks", surface: "postgrest",
      target: "user_roles", whyMissed: "misread",
    },
  });
  const driver = scripted([
    { assistantText: "", toolCalls: [same("a"), same("b")], done: false },
    { assistantText: "", toolCalls: [{ id: "c", name: "conclude", input: { summary: "" } }], done: true },
  ]);
  const leads = await reviewCampaign(driver, [outcome({ name: "agent-data" })]);
  assert.equal(leads.length, 1);
});
