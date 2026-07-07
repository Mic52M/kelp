// End-to-end verification of the customer active-pentest path (#27).
//
// Unlike the per-specialist verify:*-target scripts which drive the
// orchestrator directly, this one goes through the full scan-processor
// pipeline (the same code the queue consumer runs in production):
//
//   scans row (mode='active_pentest')
//     → runScanForProject
//     → executeActivePentestScan
//     → consent gate + plan gate + cost cap
//     → buildCustomerCampaignEntries → runActivePentest
//     → campaignFindingsToDetected → upsertFindings
//     → scans.cost_cents persisted
//
// If this exits 0 with findings written and cost_cents populated, the pipe
// end-to-end works. This is the gate that means "safe to enable in prod."
//
// Gate: KELP_ANTHROPIC_LIVE=1 required (real Anthropic calls + DB writes).
// Absent → skip with exit 0 (do NOT fail CI on missing opt-in).
//
// Assumptions:
//  - The test target is running on http://localhost:4400 (KELP_TEST_TARGET_URL
//    can override).
//  - DATABASE_URL points at a scratch database — this script writes a temp
//    org+user+project and deletes them again at the end.
//  - ANTHROPIC_API_KEY is set.

import { getPool, putCredential, saveActiveTestConsent, setAppBaseUrl } from "../db.js";
import { runScanForProject } from "../scan-processor.js";
import { CONSENT_V2_TEXT, CONSENT_VERSION_LATEST } from "@kelp/core";

const BASE_URL = process.env.KELP_TEST_TARGET_URL ?? "http://localhost:4400";

if (process.env.KELP_ANTHROPIC_LIVE !== "1") {
  console.log("verify:campaign-e2e SKIPPED — set KELP_ANTHROPIC_LIVE=1 to run.");
  console.log("This script burns real Claude tokens against " + BASE_URL);
  process.exit(0);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set — cannot run live E2E.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set — cannot seed a scratch project.");
  process.exit(1);
}

async function seedScratchProject(): Promise<{
  orgId: string;
  userId: string;
  projectId: string;
}> {
  const pool = getPool();
  const suffix = Date.now().toString(36);
  // The org must be on a paid tier for the active-pentest gate to allow it.
  const { rows: orgRows } = await pool.query(
    `insert into orgs (name, plan) values ($1, 'starter') returning id`,
    [`e2e-${suffix}`],
  );
  const orgId = orgRows[0].id as string;
  const { rows: userRows } = await pool.query(
    `insert into users (id, email) values (gen_random_uuid(), $1) returning id`,
    [`e2e+${suffix}@kelp.dev`],
  );
  const userId = userRows[0].id as string;
  await pool.query(
    `insert into memberships (org_id, user_id, role) values ($1, $2, 'owner')`,
    [orgId, userId],
  );
  const { rows: projRows } = await pool.query(
    `insert into projects (org_id, name, provider) values ($1, $2, 'github') returning id`,
    [orgId, `e2e-project-${suffix}`],
  );
  const projectId = projRows[0].id as string;
  return { orgId, userId, projectId };
}

async function cleanup(orgId: string): Promise<void> {
  const pool = getPool();
  // cascade will handle projects/scans/findings/memberships/credentials.
  await pool.query(`delete from orgs where id = $1`, [orgId]);
}

async function main(): Promise<void> {
  console.log(`kelp verify:campaign-e2e → ${BASE_URL}`);

  const { orgId, userId, projectId } = await seedScratchProject();
  console.log(`  seeded org=${orgId} project=${projectId}`);

  try {
    await setAppBaseUrl(projectId, BASE_URL);
    await putCredential(
      orgId,
      projectId,
      "app_test_account_a",
      JSON.stringify({ email: "a@test.local", password: "secretA" }),
    );
    await putCredential(
      orgId,
      projectId,
      "app_test_account_b",
      JSON.stringify({ email: "b@test.local", password: "secretB" }),
    );
    await saveActiveTestConsent({
      orgId,
      projectId,
      consentText: CONSENT_V2_TEXT,
      consentVersion: CONSENT_VERSION_LATEST,
      consentedBy: userId,
    });

    console.log("  dispatching active_pentest scan via scan-processor…");
    const outcome = await runScanForProject({
      orgId,
      projectId,
      classes: ["bola", "auth", "injection", "ssrf", "exposure", "rls"],
      trigger: "manual",
      mode: "active_pentest",
    });

    console.log(
      `  scan ${outcome.scanId} → ${outcome.found} finding(s), ${outcome.errors} specialist error(s), $${((outcome.costCents ?? 0) / 100).toFixed(4)}`,
    );

    const pool = getPool();
    const { rows: findingsRows } = await pool.query(
      `select vuln_class, count(*)::int as n from findings
        where project_id = $1 group by vuln_class order by vuln_class`,
      [projectId],
    );
    for (const r of findingsRows) console.log(`    · ${r.vuln_class}: ${r.n}`);
    const { rows: costRows } = await pool.query(
      `select cost_cents from scans where id = $1`,
      [outcome.scanId],
    );
    const costCents = costRows[0]?.cost_cents as number | null;

    // Assertions — the pipe is "safe to enable in prod" when all these hold.
    if (outcome.found === 0) {
      throw new Error("FAIL: scan wrote zero findings against a deliberately-vulnerable target");
    }
    if (costCents === null || costCents === undefined) {
      throw new Error("FAIL: scans.cost_cents not populated");
    }
    if (outcome.errors === 7) {
      throw new Error("FAIL: every specialist errored — check the customer-backends wiring");
    }

    console.log("✓ verify:campaign-e2e PASSED");
  } finally {
    await cleanup(orgId);
    console.log("  cleaned up");
    await getPool().end();
  }
}

main().catch((e) => {
  console.error("verify:campaign-e2e FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
