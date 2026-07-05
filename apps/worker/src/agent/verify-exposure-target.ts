// End-to-end validation for the exposure specialist against the running test
// target. Asserts:
//   (a) /api/admin/users-with-hashes IS flagged (response shape includes
//       password_hash, salt, password_reset_token), and
//   (b) /api/public-users is NOT flagged (response shape is id + display_name).
//
// Run:
//   1) start the test target (npm run dev -w @kelp/test-target)  → :4400
//   2) node apps/worker/dist/agent/verify-exposure-target.js

import {
  exposureSpecialist,
  runCampaignUnsafe,
  type LlmAgentDriver,
  type LlmStep,
  type SpecialistEntry,
  type ToolResult,
} from "@kelp/core";
import { createTestTargetExposureBackend } from "./test-target-exposure-backend.js";

const BASE_URL = process.env.KELP_TEST_TARGET_URL ?? "http://localhost:4400";

class ScriptedExposureDriver implements LlmAgentDriver {
  private step = 0;
  private endpoints: { endpoint: string }[] = [];
  private confirmed: string[] = [];

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
        assistantText: "Probing response shape of each endpoint.",
        toolCalls: this.endpoints.map((e, i) => ({
          id: `p${i}`,
          name: "probe_response_shape",
          input: { endpoint: e.endpoint },
        })),
        done: false,
      };
    }
    if (this.step === 2) {
      results.forEach((r, idx) => {
        if (r.content.startsWith("EXPOSURE CONFIRMED")) {
          this.confirmed.push(this.endpoints[idx]!.endpoint);
        }
      });
      this.step = 3;
      return {
        assistantText: `Reporting ${this.confirmed.length} confirmed exposure(s).`,
        toolCalls: this.confirmed.map((endpoint, i) => ({
          id: `r${i}`,
          name: "report_finding",
          input: { endpoint },
        })),
        done: false,
      };
    }
    return { assistantText: "Done.", toolCalls: [], done: true };
  }
}

async function main() {
  console.log(`kelp verify-exposure-target → ${BASE_URL}`);
  const backend = await createTestTargetExposureBackend({
    baseUrl: BASE_URL,
    accountA: { email: "a@test.local", password: "secretA" },
  });

  const entry: SpecialistEntry<unknown, unknown> = {
    specialist: exposureSpecialist as unknown as SpecialistEntry<unknown, unknown>["specialist"],
    backend: backend as unknown,
    driver: new ScriptedExposureDriver(),
  };

  const ctx = { orgId: "test-org", projectId: "test-target", jobId: "verify-5" };
  const report = await runCampaignUnsafe(ctx, { entries: [entry] });

  const outcome = report.outcomes[0]!;
  console.log(`\noutcome: ${outcome.name} (steps=${outcome.steps}, findings=${outcome.findings.length}, error=${outcome.error ?? "none"})`);
  for (const f of outcome.findings as Array<{ endpoint: string; sensitiveFields: string[] }>) {
    console.log(`  · ${f.endpoint}`);
    console.log(`      sensitive: ${f.sensitiveFields.join(", ")}`);
  }

  let failures = 0;
  const flaggedAdmin = (outcome.findings as Array<{ endpoint: string }>).some((f) =>
    f.endpoint.includes("/api/admin/users-with-hashes"),
  );
  const flaggedPublic = (outcome.findings as Array<{ endpoint: string }>).some((f) =>
    f.endpoint.includes("/api/public-users"),
  );

  if (!flaggedAdmin) {
    console.error("✗ EXPECTED /api/admin/users-with-hashes to be flagged as exposure — it was NOT");
    failures++;
  } else {
    console.log("✓ /api/admin/users-with-hashes flagged as exposure (sensitive field names detected)");
  }
  if (flaggedPublic) {
    console.error("✗ FALSE POSITIVE — /api/public-users should NOT be flagged (only id + display_name)");
    failures++;
  } else {
    console.log("✓ /api/public-users NOT flagged (only id + display_name)");
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verify-exposure-target failed:", e instanceof Error ? e.stack ?? e.message : e);
  process.exit(2);
});
