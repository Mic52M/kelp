// End-to-end validation for the weak-crypto specialist against the running
// test target. Asserts:
//   (a) /api/set-insecure-cookie IS flagged (missing HttpOnly, Secure,
//       SameSite), and
//   (b) /api/set-secure-cookie is NOT flagged (all three flags present).
//
// Run:
//   1) start the test target (npm run dev -w @kelp/test-target)  → :4400
//   2) node apps/worker/dist/agent/verify-weak-crypto-target.js

import {
  runCampaignUnsafe,
  weakCryptoSpecialist,
  type LlmAgentDriver,
  type LlmStep,
  type SpecialistEntry,
  type ToolResult,
} from "@kelp/core";
import { createTestTargetWeakCryptoBackend } from "./test-target-weak-crypto-backend.js";

const BASE_URL = process.env.KELP_TEST_TARGET_URL ?? "http://localhost:4400";

class ScriptedWeakCryptoDriver implements LlmAgentDriver {
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
        assistantText: "Probing cookie flags.",
        toolCalls: this.endpoints.map((e, i) => ({
          id: `p${i}`,
          name: "probe_cookie_flags",
          input: { endpoint: e.endpoint },
        })),
        done: false,
      };
    }
    if (this.step === 2) {
      results.forEach((r, idx) => {
        if (r.content.startsWith("WEAK-CRYPTO CONFIRMED")) {
          this.confirmed.push(this.endpoints[idx]!.endpoint);
        }
      });
      this.step = 3;
      return {
        assistantText: `Reporting ${this.confirmed.length} confirmed weak cookie(s).`,
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
  console.log(`kelp verify-weak-crypto-target → ${BASE_URL}`);
  const backend = await createTestTargetWeakCryptoBackend({
    baseUrl: BASE_URL,
    accountA: { email: "a@test.local", password: "secretA" },
  });

  const entry: SpecialistEntry<unknown, unknown> = {
    specialist: weakCryptoSpecialist as unknown as SpecialistEntry<unknown, unknown>["specialist"],
    backend: backend as unknown,
    driver: new ScriptedWeakCryptoDriver(),
  };

  const ctx = { orgId: "test-org", projectId: "test-target", jobId: "verify-7" };
  const report = await runCampaignUnsafe(ctx, { entries: [entry] });

  const outcome = report.outcomes[0]!;
  console.log(`\noutcome: ${outcome.name} (steps=${outcome.steps}, findings=${outcome.findings.length}, error=${outcome.error ?? "none"})`);
  for (const f of outcome.findings as Array<{ endpoint: string; missingFlags: string[] }>) {
    console.log(`  · ${f.endpoint}`);
    console.log(`      missing: ${f.missingFlags.join(", ")}`);
  }

  let failures = 0;
  const flaggedInsecure = (outcome.findings as Array<{ endpoint: string }>).some((f) =>
    f.endpoint.includes("/api/set-insecure-cookie"),
  );
  const flaggedSecure = (outcome.findings as Array<{ endpoint: string }>).some((f) =>
    f.endpoint.includes("/api/set-secure-cookie"),
  );

  if (!flaggedInsecure) {
    console.error("✗ EXPECTED /api/set-insecure-cookie to be flagged — it was NOT");
    failures++;
  } else {
    console.log("✓ /api/set-insecure-cookie flagged (missing required cookie flags)");
  }
  if (flaggedSecure) {
    console.error("✗ FALSE POSITIVE — /api/set-secure-cookie should NOT be flagged");
    failures++;
  } else {
    console.log("✓ /api/set-secure-cookie NOT flagged (HttpOnly + Secure + SameSite all present)");
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verify-weak-crypto-target failed:", e instanceof Error ? e.stack ?? e.message : e);
  process.exit(2);
});
