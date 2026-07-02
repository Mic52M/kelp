// Applies packages/db/migrations/*.sql to DATABASE_URL, in filename order.
// Each file is self-contained (wrapped in begin;/commit;) and idempotent-ish
// (uses IF NOT EXISTS where practical). Run:
//
//   node --env-file=.env.local packages/db/src/migrate.ts
//
// Intentionally minimal — no migration bookkeeping table yet (that lands with a
// real migration tool). For now it just replays every file; re-running will
// error on duplicate CREATE TYPE etc., which is fine while the schema is young.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (pass --env-file=.env.local)");
  process.exit(1);
}

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false }, // Supabase requires SSL
});

await client.connect();
console.log(`Connected. Applying ${files.length} migration(s):`);
try {
  for (const f of files) {
    process.stdout.write(`  ${f} … `);
    await client.query(readFileSync(path.join(migrationsDir, f), "utf8"));
    console.log("ok");
  }
  console.log("Done.");
} catch (e) {
  console.error("\nMigration failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await client.end();
}
