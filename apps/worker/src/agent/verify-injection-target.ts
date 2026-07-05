// End-to-end validation for the injection specialist against the running test
// target. Mirrors verify-bola-target and verify-auth-bypass-target:
//   (a) /api/orders/search IS flagged (baseline vs payload count difference), and
//   (b) /api/orders/find is NOT flagged (parameterised — no bypass).
//
// Run:
//   1) start the test target (npm run dev -w @kelp/test-target)  → :4400
//   2) node apps/worker/dist/agent/verify-injection-target.js

import {
  injectionSpecialist,
  runCampaignUnsafe,
  type LlmAgentDriver,
  type LlmStep,
  type SpecialistEntry,
  type ToolResult,
} from "@kelp/core";
import { createTestTargetInjectionBackend } from "./test-target-injection-backend.js";

const BASE_URL = process.env.KELP_TEST_TARGET_URL ?? "http://localhost:4400";

class ScriptedInjectionDriver implements LlmAgentDriver {
  private step = 0;
  private endpoints: { endpoint: string; parameter: string }[] = [];
  private confirmed: Array<{ endpoint: string; parameter: string }> = [];

  async start(): Promise<LlmStep> {
    this.step = 1;
    return {
      assistantText: "Listing endpoints.",
      toolCalls: [{ id: "list", name: "list_endpoints", input: {} }],
      done: false,
    };
  }

  async provideToolResults(results: ToolResult[]): Promise<LlmStep> {
    if (this.step === 1) {
      this.endpoints = JSON.parse(results[0]!.content) as typeof this.endpoints;
      this.step = 2;
      return {
        assistantText: "Probing each parameter.",
        toolCalls: this.endpoints.map((e, idx) => ({
          id: `p${idx}`,
          name: "probe_injection",
          input: { endpoint: e.endpoint, parameter: e.parameter },
        })),
        done: false,
      };
    }
    if (this.step === 2) {
      results.forEach((r, idx) => {
        if (r.content.startsWith("injection CONFIRMED")) {
          this.confirmed.push(this.endpoints[idx]!);
        }
      });
      this.step = 3;
      return {
        assistantText: `Reporting ${this.confirmed.length} confirmed injection(s).`,
        toolCalls: this.confirmed.map((c, i) => ({
          id: `r${i}`,
          name: "report_finding",
          input: { endpoint: c.endpoint, parameter: c.parameter },
        })),
        done: false,
      };
    }
    return { assistantText: "Done.", toolCalls: [], done: true };
  }
}

async function main() {
  console.log(`kelp verify-injection-target → ${BASE_URL}`);
  const backend = await createTestTargetInjectionBackend({
    baseUrl: BASE_URL,
    accountA: { email: "a@test.local", password: "secretA" },
  });

  const entry: SpecialistEntry<unknown, unknown> = {
    specialist: injectionSpecialist as unknown as SpecialistEntry<unknown, unknown>["specialist"],
    backend: backend as unknown,
    driver: new ScriptedInjectionDriver(),
  };

  const ctx = { orgId: "test-org", projectId: "test-target", jobId: "verify-3" };
  const report = await runCampaignUnsafe(ctx, { entries: [entry] });

  const outcome = report.outcomes[0]!;
  console.log(`\noutcome: ${outcome.name} (steps=${outcome.steps}, findings=${outcome.findings.length}, error=${outcome.error ?? "none"})`);
  for (const f of outcome.findings as Array<{ endpoint: string; parameter: string; payloadFamily: string }>) {
    console.log(`  · ${f.payloadFamily} @ ${f.endpoint} [${f.parameter}]`);
  }

  let failures = 0;
  const flaggedSearch = (outcome.findings as Array<{ endpoint: string }>).some((f) =>
    f.endpoint.includes("/api/orders/search"),
  );
  const flaggedFind = (outcome.findings as Array<{ endpoint: string }>).some((f) =>
    f.endpoint.includes("/api/orders/find"),
  );

  if (!flaggedSearch) {
    console.error("✗ EXPECTED /api/orders/search to be flagged as injection — it was NOT");
    failures++;
  } else {
    console.log("✓ /api/orders/search flagged as injection (evidence: payload widened count vs baseline)");
  }
  if (flaggedFind) {
    console.error("✗ FALSE POSITIVE — /api/orders/find should NOT be flagged (parameterised)");
    failures++;
  } else {
    console.log("✓ /api/orders/find NOT flagged (parameterised — no bypass)");
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verify-injection-target failed:", e instanceof Error ? e.stack ?? e.message : e);
  process.exit(2);
});
