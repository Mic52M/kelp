// Seeds a real project + queued scan for the founder+demo test org, then drains
// the queue — verifying the full pipeline persists real findings to the DB.
//
//   node --env-file=.env.local apps/worker/dist/seed-scan.js

import { getPool, putCredential } from "./db.js";
import { drainScans } from "./scan-processor.js";

const DEMO_EMAIL = "founder+demo@kelp.build";
const REPO = "Mic52M/auto-spark-flows";
const SUPABASE_REF = "hebrhezulnxlhgrfbegt"; // Lunea

async function main() {
  const pool = getPool();

  const { rows: orgRows } = await pool.query(
    `select o.id from orgs o
       join memberships m on m.org_id = o.id
       join users u on u.id = m.user_id
     where u.email = $1 limit 1`,
    [DEMO_EMAIL],
  );
  if (orgRows.length === 0) throw new Error(`no org for ${DEMO_EMAIL} — sign up first`);
  const orgId = orgRows[0].id as string;

  const installationId = Number(process.env.GITHUB_APP_INSTALLATION_ID);

  const { rows: projRows } = await pool.query(
    `insert into projects
       (org_id, name, github_repo_full_name, github_installation_id, db_provider, supabase_project_ref)
     values ($1, $2, $3, $4, 'supabase', $5)
     returning id`,
    [orgId, "auto-spark-flows", REPO, installationId, SUPABASE_REF],
  );
  const projectId = projRows[0].id as string;
  console.log(`✓ project ${projectId} (${REPO} + Supabase ${SUPABASE_REF})`);

  await putCredential(orgId, projectId, "supabase_management", process.env.SUPABASE_MANAGEMENT_TOKEN!);
  console.log("✓ encrypted Supabase management token stored");

  const { rows: scanRows } = await pool.query(
    `insert into scans (org_id, project_id, status, trigger, classes)
     values ($1, $2, 'queued', 'initial', $3::vuln_class[])
     returning id`,
    [orgId, projectId, ["secret", "rls"]],
  );
  console.log(`✓ queued scan ${scanRows[0].id}\n`);

  console.log("Processing queue…");
  await drainScans();

  const { rows: found } = await pool.query(
    `select vuln_class, severity, title, location, status
     from findings where project_id = $1 order by
       array_position(array['critical','high','medium','low']::text[], severity::text)`,
    [projectId],
  );
  console.log(`\n${found.length} finding(s) persisted:`);
  for (const f of found) {
    console.log(`  [${f.severity}] ${f.vuln_class.toUpperCase()} — ${f.title}  (${f.location}) · ${f.status}`);
  }

  await pool.end();
}

main().catch((e) => {
  console.error("seed-scan failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
