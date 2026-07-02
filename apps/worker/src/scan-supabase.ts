// Runs a REAL RLS scan against a Supabase project via the Management API.
//
//   npm run build
//   node --env-file=.env.local apps/worker/dist/scan-supabase.js [project-ref]
//
// Defaults to the auto-spark-flows project ref if none is given.

import { analyzeRls, generateRlsMigration } from "@kelp/core";
import { createSupabaseConnector } from "./connectors/supabase.js";

const SEV_ICON: Record<string, string> = { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵" };
const DEFAULT_REF = "ryiquemxopxmptleataz";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name} (pass --env-file=.env.local)`);
  return v;
}

async function main() {
  const ref = process.argv[2] ?? DEFAULT_REF;
  const connector = createSupabaseConnector({
    managementToken: requireEnv("SUPABASE_MANAGEMENT_TOKEN"),
  });

  console.log(`\n▶ reading schema for project ${ref}…`);
  const snapshot = await connector.getSchemaSnapshot(ref);
  console.log(
    `  ${snapshot.tables.length} object(s) in public ` +
      `(${snapshot.tables.filter((t) => !t.isView).length} tables, ` +
      `${snapshot.tables.filter((t) => t.isView).length} views)`,
  );

  const findings = analyzeRls(snapshot);
  if (findings.length === 0) {
    console.log("\n✓ No RLS issues found.\n");
    return;
  }

  console.log(`\n${findings.length} RLS finding(s):\n`);
  for (const f of findings) {
    console.log(`  ${SEV_ICON[f.severity]} [${f.severity}] ${f.title}`);
    console.log(`       ↳ ${f.schema}.${f.table}${f.fixable ? "  · fix available" : ""}`);
  }

  // Show the generated migration for the first fixable finding.
  const fixable = findings.find((f) => f.fixable && f.ownershipColumn);
  if (fixable) {
    console.log(`\n— proposed fix for ${fixable.schema}.${fixable.table} (review before applying) —\n`);
    console.log(
      generateRlsMigration(
        { schema: fixable.schema, name: fixable.table },
        fixable.ownershipColumn!,
      ),
    );
  }
}

main().catch((e) => {
  console.error("scan failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
