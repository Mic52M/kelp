// End-to-end validation for the SSRF specialist against the running test
// target. Asserts:
//   (a) /api/fetch IS flagged (the callback listener records a hit — the
//       target actually made the request), and
//   (b) /api/fetch-safe is NOT flagged (allowlist rejects the probe URL
//       before any request goes out).
//
// Run:
//   1) start the test target (npm run dev -w @kelp/test-target)  → :4400
//   2) node apps/worker/dist/agent/verify-ssrf-target.js

import {
  runCampaignUnsafe,
  ssrfSpecialist,
  type LlmAgentDriver,
  type LlmStep,
  type SpecialistEntry,
  type ToolResult,
} from "@kelp/core";
import { createTestTargetSsrfBackend } from "./test-target-ssrf-backend.js";

const BASE_URL = process.env.KELP_TEST_TARGET_URL ?? "http://localhost:4400";

/**
 * Deterministic driver — lists endpoints, probes each with a few relevant
 * techniques, reports the confirmed pairs.
 */
class ScriptedSsrfDriver implements LlmAgentDriver {
  private step = 0;
  private endpoints: { endpoint: string; parameter: string }[] = [];
  private confirmed: Array<{ endpoint: string; parameter: string; technique: string }> = [];
  private probes: Array<{ endpoint: string; parameter: string; technique: string }> = [];

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
      const techniques = ["plain_http", "loopback_localhost"] as const;
      this.probes = this.endpoints.flatMap((e) =>
        techniques.map((t) => ({ endpoint: e.endpoint, parameter: e.parameter, technique: t })),
      );
      return {
        assistantText: "Probing each URL parameter with two techniques.",
        toolCalls: this.probes.map((p, idx) => ({
          id: `p${idx}`,
          name: "probe_ssrf",
          input: p,
        })),
        done: false,
      };
    }
    if (this.step === 2) {
      results.forEach((r, idx) => {
        if (r.content.startsWith("SSRF CONFIRMED")) {
          this.confirmed.push(this.probes[idx]!);
        }
      });
      this.step = 3;
      return {
        assistantText: `Reporting ${this.confirmed.length} confirmed SSRF(s).`,
        toolCalls: this.confirmed.map((c, i) => ({
          id: `r${i}`,
          name: "report_finding",
          input: c,
        })),
        done: false,
      };
    }
    return { assistantText: "Done.", toolCalls: [], done: true };
  }
}

async function main() {
  console.log(`kelp verify-ssrf-target → ${BASE_URL}`);
  const backend = await createTestTargetSsrfBackend({
    baseUrl: BASE_URL,
    accountA: { email: "a@test.local", password: "secretA" },
  });

  try {
    const entry: SpecialistEntry<unknown, unknown> = {
      specialist: ssrfSpecialist as unknown as SpecialistEntry<unknown, unknown>["specialist"],
      backend: backend as unknown,
      driver: new ScriptedSsrfDriver(),
    };

    const ctx = { orgId: "test-org", projectId: "test-target", jobId: "verify-4" };
    const report = await runCampaignUnsafe(ctx, { entries: [entry] });

    const outcome = report.outcomes[0]!;
    console.log(`\noutcome: ${outcome.name} (steps=${outcome.steps}, findings=${outcome.findings.length}, error=${outcome.error ?? "none"})`);
    for (const f of outcome.findings as Array<{ endpoint: string; technique: string }>) {
      console.log(`  · ${f.technique} @ ${f.endpoint}`);
    }

    let failures = 0;
    const flaggedFetch = (outcome.findings as Array<{ endpoint: string }>).some(
      (f) => /\/api\/fetch$/.test(f.endpoint) || f.endpoint.endsWith("/api/fetch"),
    );
    const flaggedSafe = (outcome.findings as Array<{ endpoint: string }>).some((f) =>
      f.endpoint.includes("/api/fetch-safe"),
    );

    if (!flaggedFetch) {
      console.error("✗ EXPECTED /api/fetch to be flagged as SSRF — it was NOT");
      failures++;
    } else {
      console.log("✓ /api/fetch flagged as SSRF (callback listener recorded the hit)");
    }
    if (flaggedSafe) {
      console.error("✗ FALSE POSITIVE — /api/fetch-safe should NOT be flagged (allowlist rejects)");
      failures++;
    } else {
      console.log("✓ /api/fetch-safe NOT flagged (allowlist rejected the probe URL)");
    }

    process.exit(failures === 0 ? 0 : 1);
  } finally {
    backend.close();
  }
}

main().catch((e) => {
  console.error("verify-ssrf-target failed:", e instanceof Error ? e.stack ?? e.message : e);
  process.exit(2);
});
