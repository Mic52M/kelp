// End-to-end validation for the auth-bypass specialist against the running
// test target. Mirrors verify-bola-target.ts:
//   (a) /api/session-lookup IS flagged via the query_as_param technique
//       (real HTTP call confirmed the identity swap), and
//   (b) /api/me is NOT flagged (no impersonation technique bypassed it).
//
// Uses a scripted driver — same rationale as the BOLA verify script.
//
// Run:
//   1) start the test target (npm run dev -w @kelp/test-target)  → :4400
//   2) node apps/worker/dist/agent/verify-auth-bypass-target.js

import {
  authBypassSpecialist,
  runCampaignUnsafe,
  type LlmAgentDriver,
  type LlmStep,
  type SpecialistEntry,
  type ToolResult,
} from "@kelp/core";
import { createTestTargetAuthBypassBackend } from "./test-target-auth-bypass-backend.js";

const BASE_URL = process.env.KELP_TEST_TARGET_URL ?? "http://localhost:4400";

/**
 * Deterministic driver — lists, probes each (endpoint, technique) pair the
 * target exposes, then reports the confirmed ones.
 */
class ScriptedAuthBypassDriver implements LlmAgentDriver {
  private step = 0;
  private endpoints: { endpoint: string }[] = [];
  private confirmed: Array<{ endpoint: string; technique: string }> = [];

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
      // Probe each endpoint with two techniques for coverage.
      const calls = this.endpoints.flatMap((e) => [
        { id: `p-qas-${e.endpoint}`, name: "probe_impersonation", input: { endpoint: e.endpoint, technique: "query_as_param" as const } },
        { id: `p-xhdr-${e.endpoint}`, name: "probe_impersonation", input: { endpoint: e.endpoint, technique: "x_user_header" as const } },
      ]);
      return { assistantText: "Probing techniques.", toolCalls: calls, done: false };
    }
    if (this.step === 2) {
      // Extract confirmed pairs from the tool-call ids we scheduled.
      results.forEach((r, idx) => {
        if (r.content.startsWith("bypass SUCCEEDED")) {
          const pairIdx = Math.floor(idx / 2);
          const techniqueIdx = idx % 2;
          const endpoint = this.endpoints[pairIdx]!.endpoint;
          const technique = techniqueIdx === 0 ? "query_as_param" : "x_user_header";
          this.confirmed.push({ endpoint, technique });
        }
      });
      this.step = 3;
      const reports = this.confirmed.map((c, i) => ({
        id: `r${i}`,
        name: "report_finding",
        input: { endpoint: c.endpoint, technique: c.technique },
      }));
      return {
        assistantText: `Reporting ${reports.length} confirmed bypass(es).`,
        toolCalls: reports,
        done: false,
      };
    }
    return { assistantText: "Done.", toolCalls: [], done: true };
  }
}

async function main() {
  console.log(`kelp verify-auth-bypass-target → ${BASE_URL}`);
  const backend = await createTestTargetAuthBypassBackend({
    baseUrl: BASE_URL,
    accountA: { email: "a@test.local", password: "secretA" },
    targetUserId: "userB",
    targetOwnedIds: ["ord_2001", "ord_2002"],
  });

  const entry: SpecialistEntry<unknown, unknown> = {
    specialist: authBypassSpecialist as unknown as SpecialistEntry<unknown, unknown>["specialist"],
    backend: backend as unknown,
    driver: new ScriptedAuthBypassDriver(),
  };

  const ctx = { orgId: "test-org", projectId: "test-target", jobId: "verify-2" };
  const report = await runCampaignUnsafe(ctx, { entries: [entry] });

  const outcome = report.outcomes[0]!;
  console.log(`\noutcome: ${outcome.name} (steps=${outcome.steps}, findings=${outcome.findings.length}, error=${outcome.error ?? "none"})`);
  for (const f of outcome.findings as Array<{ endpoint: string; technique: string }>) {
    console.log(`  · ${f.technique} @ ${f.endpoint}`);
  }

  let failures = 0;
  const flaggedSession = (outcome.findings as Array<{ endpoint: string }>).some((f) =>
    f.endpoint.includes("/api/session-lookup"),
  );
  const flaggedMe = (outcome.findings as Array<{ endpoint: string }>).some((f) =>
    f.endpoint.includes("/api/me"),
  );

  if (!flaggedSession) {
    console.error("✗ EXPECTED /api/session-lookup to be flagged (query_as_param) — it was NOT");
    failures++;
  } else {
    console.log("✓ /api/session-lookup flagged (evidence-confirmed identity swap)");
  }
  if (flaggedMe) {
    console.error("✗ FALSE POSITIVE — /api/me should NOT be flagged");
    failures++;
  } else {
    console.log("✓ /api/me NOT flagged (no impersonation technique bypassed it)");
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verify-auth-bypass-target failed:", e instanceof Error ? e.stack ?? e.message : e);
  process.exit(2);
});
