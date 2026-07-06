// End-to-end verification for cost accounting (issue #25).
//
// Runs a scripted 3-specialist campaign, wraps each driver in a metered wrapper
// that reports fixed usage, and asserts:
//   1. every SpecialistOutcome.usage is populated,
//   2. CampaignReport.totalUsage is the sum,
//   3. estimateCostUsd math matches the model's published rate.
//
// This is worker-side (not core-side) because it exercises the whole path a
// production campaign would follow, without needing an Anthropic key. The
// live-driver variants (#26) prove the real driver populates usage; this
// verify proves the accounting plumbing.

import Anthropic from "@anthropic-ai/sdk";
import {
  authBypassSpecialist,
  bolaSpecialist,
  injectionSpecialist,
  runCampaignUnsafe,
  type AgentTool,
  type LlmAgentDriver,
  type LlmStep,
  type LlmUsage,
  type SpecialistEntry,
  type ToolResult,
} from "@kelp/core";
import { createAnthropicDriver } from "./anthropic-driver.js";

/** A driver that yields "done" immediately but reports fixed usage. Sufficient
 *  to prove the plumbing — the specialists finish with zero findings, which is
 *  fine: this verify is about accounting, not detection. */
class MeteredNoopDriver implements LlmAgentDriver {
  constructor(private readonly usage: LlmUsage) {}
  async start(_opts: { system: string; tools: AgentTool[]; prompt: string }): Promise<LlmStep> {
    return { assistantText: "noop", toolCalls: [], done: true };
  }
  async provideToolResults(_r: ToolResult[]): Promise<LlmStep> {
    return { assistantText: "noop", toolCalls: [], done: true };
  }
  getUsage(): LlmUsage {
    return this.usage;
  }
}

async function main() {
  console.log("kelp verify-cost-accounting → scripted 3-specialist campaign");

  // Also prove the real Anthropic driver EXPOSES getUsage — without calling it,
  // so we don't need an API key. Just an interface sanity check.
  const anthClient = new Anthropic({ apiKey: "sk-not-used" });
  const realDriver = createAnthropicDriver(anthClient, "claude-haiku-4-5");
  if (typeof realDriver.getUsage !== "function") {
    console.error("✗ createAnthropicDriver does not implement getUsage()");
    process.exit(1);
  }
  const initial = realDriver.getUsage!();
  if (initial.inputTokens !== 0 || initial.outputTokens !== 0 || initial.model !== "claude-haiku-4-5") {
    console.error("✗ initial usage should be zero and carry the model id:", initial);
    process.exit(1);
  }
  console.log("✓ createAnthropicDriver exposes getUsage() with model=claude-haiku-4-5 at 0/0 initially");

  const entries: SpecialistEntry<unknown, unknown>[] = [
    {
      specialist: bolaSpecialist as unknown as SpecialistEntry<unknown, unknown>["specialist"],
      backend: {} as unknown,
      driver: new MeteredNoopDriver({ inputTokens: 1000, outputTokens: 500, model: "claude-haiku-4-5" }),
    },
    {
      specialist: authBypassSpecialist as unknown as SpecialistEntry<unknown, unknown>["specialist"],
      backend: {} as unknown,
      driver: new MeteredNoopDriver({ inputTokens: 2000, outputTokens: 750, model: "claude-opus-4-8" }),
    },
    {
      specialist: injectionSpecialist as unknown as SpecialistEntry<unknown, unknown>["specialist"],
      backend: {} as unknown,
      driver: new MeteredNoopDriver({ inputTokens: 500, outputTokens: 200, model: "claude-sonnet-5" }),
    },
  ];

  const ctx = { orgId: "test-org", projectId: "test-project", jobId: "verify-cost" };
  const report = await runCampaignUnsafe(ctx, { entries });

  let failures = 0;
  for (const [i, o] of report.outcomes.entries()) {
    if (!o.usage) {
      console.error(`✗ outcome[${i}] (${o.name}) has null usage`);
      failures++;
    } else {
      console.log(
        `  · ${o.name}: in=${o.usage.inputTokens} out=${o.usage.outputTokens} ` +
          `cost=$${o.usage.estimatedCostUsd.toFixed(6)}`,
      );
    }
  }

  const expectedTotalIn = 1000 + 2000 + 500;
  const expectedTotalOut = 500 + 750 + 200;
  if (report.totalUsage.inputTokens !== expectedTotalIn) {
    console.error(`✗ totalUsage.inputTokens: expected ${expectedTotalIn}, got ${report.totalUsage.inputTokens}`);
    failures++;
  }
  if (report.totalUsage.outputTokens !== expectedTotalOut) {
    console.error(`✗ totalUsage.outputTokens: expected ${expectedTotalOut}, got ${report.totalUsage.outputTokens}`);
    failures++;
  }
  // Deterministic per-model cost math:
  //   haiku : 1000*1e-6 + 500*5e-6   = 0.0035
  //   opus  : 2000*15e-6 + 750*75e-6 = 0.086250
  //   sonnet:  500*3e-6 + 200*15e-6  = 0.004500
  //   total = 0.09425
  const expectedTotalCost = 0.09425;
  const diff = Math.abs(report.totalUsage.estimatedCostUsd - expectedTotalCost);
  if (diff > 1e-9) {
    console.error(
      `✗ totalUsage.estimatedCostUsd: expected ${expectedTotalCost}, got ${report.totalUsage.estimatedCostUsd}`,
    );
    failures++;
  }

  if (failures === 0) {
    console.log(
      `\n✓ 3-specialist campaign cost accounting OK — total ${report.totalUsage.inputTokens}+${report.totalUsage.outputTokens} tokens, ≈$${report.totalUsage.estimatedCostUsd.toFixed(4)}`,
    );
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verify-cost-accounting failed:", e instanceof Error ? e.stack ?? e.message : e);
  process.exit(2);
});
