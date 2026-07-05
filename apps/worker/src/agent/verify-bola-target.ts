// End-to-end validation: point the BOLA specialist at the running test target
// (apps/test-target) and prove that
//   (a) it flags the vulnerable /api/orders/:id endpoint with confirmed
//       evidence (account A actually read one of account B's orders), and
//   (b) it does NOT flag the properly-scoped /api/profiles/:id.
//
// Uses a scripted LLM driver — the point here is to validate the specialist's
// EXECUTOR and the probe backend, not the Claude prompt. A future
// verify-bola-target-live.ts will use the real Anthropic driver.
//
// Run:
//   1) start the test target (npm run dev -w @kelp/test-target)  → :4400
//   2) node apps/worker/dist/agent/verify-bola-target.js
//
// Exits 0 on success, non-zero if the invariant fails.

import {
  bolaSpecialist,
  runCampaignUnsafe,
  type LlmAgentDriver,
  type LlmStep,
  type SpecialistEntry,
  type ToolResult,
} from "@kelp/core";
import { createTestTargetBolaBackend } from "./test-target-backend.js";

const BASE_URL = process.env.KELP_TEST_TARGET_URL ?? "http://localhost:4400";

/**
 * Deterministic driver that mirrors what a well-behaved Claude would do:
 * list, probe both endpoints, then report only the confirmed one.
 */
class ScriptedBolaDriver implements LlmAgentDriver {
  private i = 0;
  private endpoints: { endpoint: string; resourceKind: string; idParameter: string }[] = [];
  private probeVerdicts = new Map<string, boolean>();

  async start(): Promise<LlmStep> {
    this.i = 1;
    return {
      assistantText: "Listing endpoints.",
      toolCalls: [{ id: "list", name: "list_endpoints", input: {} }],
      done: false,
    };
  }

  async provideToolResults(results: ToolResult[]): Promise<LlmStep> {
    // Step 1: after list_endpoints — parse the list, schedule a probe for each.
    if (this.i === 1) {
      const r = results[0]!;
      this.endpoints = JSON.parse(r.content) as typeof this.endpoints;
      this.i = 2;
      return {
        assistantText: "Probing endpoints.",
        toolCalls: this.endpoints.map((e, idx) => ({
          id: `probe${idx}`,
          name: "probe_endpoint",
          input: { endpoint: e.endpoint, parameter: e.idParameter },
        })),
        done: false,
      };
    }
    // Step 2: probe results in — record which ones confirmed, then report those.
    if (this.i === 2) {
      results.forEach((r, idx) => {
        const ep = this.endpoints[idx]!;
        this.probeVerdicts.set(ep.endpoint, r.content.startsWith("cross-account"));
      });
      this.i = 3;
      const reportCalls = this.endpoints
        .filter((e) => this.probeVerdicts.get(e.endpoint))
        .map((e, idx) => ({
          id: `report${idx}`,
          name: "report_finding",
          input: {
            endpoint: e.endpoint,
            parameter: e.idParameter,
            resourceKind: e.resourceKind,
          },
        }));
      return {
        assistantText: `Confirmed ${reportCalls.length} endpoint(s), reporting.`,
        toolCalls: reportCalls,
        done: false,
      };
    }
    return { assistantText: "Done.", toolCalls: [], done: true };
  }
}

async function main() {
  console.log(`kelp verify-bola-target → ${BASE_URL}`);
  const backend = await createTestTargetBolaBackend({
    baseUrl: BASE_URL,
    accountA: { email: "a@test.local", password: "secretA" },
    accountB: { email: "b@test.local", password: "secretB" },
    bOwnedIds: ["ord_2001", "ord_2002", "prf_b"],
  });

  const entry: SpecialistEntry<unknown, unknown> = {
    specialist: bolaSpecialist as unknown as SpecialistEntry<unknown, unknown>["specialist"],
    backend: backend as unknown,
    driver: new ScriptedBolaDriver(),
  };

  const ctx = { orgId: "test-org", projectId: "test-target", jobId: "verify-1" };
  const report = await runCampaignUnsafe(ctx, { entries: [entry] });

  const outcome = report.outcomes[0]!;
  console.log(`\noutcome: ${outcome.name} (steps=${outcome.steps}, findings=${outcome.findings.length}, error=${outcome.error ?? "none"})`);
  for (const f of outcome.findings as Array<{ endpoint: string; resourceKind: string }>) {
    console.log(`  · ${f.resourceKind} @ ${f.endpoint}`);
  }

  // Assertions: the invariant must hold.
  let failures = 0;
  const flaggedOrders = (outcome.findings as Array<{ endpoint: string }>).some((f) =>
    f.endpoint.includes("/api/orders/"),
  );
  const flaggedProfiles = (outcome.findings as Array<{ endpoint: string }>).some((f) =>
    f.endpoint.includes("/api/profiles/"),
  );
  if (!flaggedOrders) {
    console.error("✗ EXPECTED /api/orders/:id to be flagged as BOLA — it was NOT");
    failures++;
  } else {
    console.log("✓ /api/orders/:id flagged as BOLA (evidence-confirmed)");
  }
  if (flaggedProfiles) {
    console.error("✗ FALSE POSITIVE — /api/profiles/:id should NOT be flagged");
    failures++;
  } else {
    console.log("✓ /api/profiles/:id NOT flagged (correctly denied cross-account)");
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verify-bola-target failed:", e instanceof Error ? e.stack ?? e.message : e);
  process.exit(2);
});
