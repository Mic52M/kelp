// End-to-end validation for the RLS-deep specialist against the running test
// target's mock DB (apps/test-target /api/db/*). Asserts:
//   (a) orders_public IS flagged (RLS off — cross-account read succeeds), and
//   (b) orders_scoped is NOT flagged (RLS on — cross-account read denied).
//
// Run:
//   1) start the test target (npm run dev -w @kelp/test-target)  → :4400
//   2) node apps/worker/dist/agent/verify-rls-deep-target.js

import {
  rlsDeepSpecialist,
  runCampaignUnsafe,
  type LlmAgentDriver,
  type LlmStep,
  type SpecialistEntry,
  type ToolResult,
} from "@kelp/core";
import { createTestTargetRlsDeepBackend } from "./test-target-rls-deep-backend.js";

const BASE_URL = process.env.KELP_TEST_TARGET_URL ?? "http://localhost:4400";

class ScriptedRlsDeepDriver implements LlmAgentDriver {
  private step = 0;
  private tables: { table: string }[] = [];
  private confirmed: string[] = [];

  async start(): Promise<LlmStep> {
    this.step = 1;
    return {
      assistantText: "Listing tables.",
      toolCalls: [{ id: "list", name: "list_tables", input: {} }],
      done: false,
    };
  }

  async provideToolResults(results: ToolResult[]): Promise<LlmStep> {
    if (this.step === 1) {
      this.tables = JSON.parse(results[0]!.content) as typeof this.tables;
      this.step = 2;
      return {
        assistantText: "Probing each table cross-account.",
        toolCalls: this.tables.map((t, i) => ({
          id: `p${i}`,
          name: "probe_cross_account_read",
          input: { table: t.table },
        })),
        done: false,
      };
    }
    if (this.step === 2) {
      results.forEach((r, idx) => {
        if (r.content.startsWith("cross-account read SUCCEEDED")) {
          this.confirmed.push(this.tables[idx]!.table);
        }
      });
      this.step = 3;
      return {
        assistantText: `Reporting ${this.confirmed.length} confirmed leak(s).`,
        toolCalls: this.confirmed.map((table, i) => ({
          id: `r${i}`,
          name: "report_finding",
          input: { table },
        })),
        done: false,
      };
    }
    return { assistantText: "Done.", toolCalls: [], done: true };
  }
}

async function main() {
  console.log(`kelp verify-rls-deep-target → ${BASE_URL}`);
  const backend = await createTestTargetRlsDeepBackend({
    baseUrl: BASE_URL,
    accountA: { email: "a@test.local", password: "secretA" },
    targetOwnerId: "userB",
  });

  const entry: SpecialistEntry<unknown, unknown> = {
    specialist: rlsDeepSpecialist as unknown as SpecialistEntry<unknown, unknown>["specialist"],
    backend: backend as unknown,
    driver: new ScriptedRlsDeepDriver(),
  };

  const ctx = { orgId: "test-org", projectId: "test-target", jobId: "verify-6" };
  const report = await runCampaignUnsafe(ctx, { entries: [entry] });

  const outcome = report.outcomes[0]!;
  console.log(`\noutcome: ${outcome.name} (steps=${outcome.steps}, findings=${outcome.findings.length}, error=${outcome.error ?? "none"})`);
  for (const f of outcome.findings as Array<{ table: string }>) {
    console.log(`  · ${f.table}`);
  }

  let failures = 0;
  const flaggedPublic = (outcome.findings as Array<{ table: string }>).some((f) => f.table === "orders_public");
  const flaggedScoped = (outcome.findings as Array<{ table: string }>).some((f) => f.table === "orders_scoped");

  if (!flaggedPublic) {
    console.error("✗ EXPECTED orders_public to be flagged (RLS off — cross-account read succeeds)");
    failures++;
  } else {
    console.log("✓ orders_public flagged (RLS off — evidence-confirmed cross-account read)");
  }
  if (flaggedScoped) {
    console.error("✗ FALSE POSITIVE — orders_scoped should NOT be flagged (RLS on, deny)");
    failures++;
  } else {
    console.log("✓ orders_scoped NOT flagged (RLS enforced the deny)");
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verify-rls-deep-target failed:", e instanceof Error ? e.stack ?? e.message : e);
  process.exit(2);
});
