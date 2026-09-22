// Regression guard: the headline `kelp scan <path>` command must surface the
// static RLS + Storage ACL findings that the core engine produces from
// supabase/migrations/*.sql.
//
// These analyzers shipped in 0.9.0 / 0.10.0 but for two releases were only
// wired into the MCP surface, so `kelp scan` silently dropped them. This test
// spawns the CLI over a fixture with a known-bad migration and asserts the
// findings come through the JSON output, so the wiring can't rot again.
//
// Runs the TypeScript entry directly through tsx (same as `npm test`), so it
// needs no build step.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.resolve(__dirname, "..", "src", "index.ts");

// One migration that trips several checks at once:
//   - public bucket (storage_public_bucket)
//   - USING (true) policy on storage.objects (storage_policy_permissive)
//   - table with RLS on but no policy for app users (base RLS finding)
const MIGRATION = `
create table public.notes (id uuid primary key, body text);
alter table public.notes enable row level security;
insert into storage.buckets (id, name, public) values ('docs','docs', true);
create policy "docs_all" on storage.objects for all to authenticated using (true);
`;

async function runScanJson(target: string): Promise<{ code: number; json: any }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", ENTRY, "scan", target, "--json"],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        resolve({ code: code ?? -1, json: JSON.parse(out) });
      } catch (e) {
        reject(new Error(`bad JSON from CLI (exit ${code}): ${out.slice(0, 200)}`));
      }
    });
  });
}

test("kelp scan surfaces static RLS + storage findings from migrations", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kelp-scan-schema-"));
  try {
    const migDir = path.join(dir, "supabase", "migrations");
    await fs.mkdir(migDir, { recursive: true });
    await fs.writeFile(path.join(migDir, "0001_init.sql"), MIGRATION, "utf8");

    const { code, json } = await runScanJson(dir);

    // Findings present, so a non-zero exit is expected.
    assert.equal(code, 1, "scan should exit 1 when it finds something");

    // The schema checks ran and reported through the CLI's own JSON shape.
    assert.equal(json.checks.rlsSchema.applicable, true);
    assert.equal(json.checks.storageAcl.applicable, true);
    assert.ok(json.checks.storageAcl.findings >= 2, "expected >=2 storage findings");

    const sources = new Set(json.findings.map((f: any) => f.source));
    assert.ok(sources.has("storage-acl"), "storage-acl findings must reach the CLI output");

    const ruleIds = new Set(json.findings.map((f: any) => f.ruleId));
    assert.ok(ruleIds.has("storage_public_bucket"), "public bucket must be flagged");
    assert.ok(
      ruleIds.has("storage_policy_permissive"),
      "USING (true) storage policy must be flagged",
    );

    // Every schema finding must carry a location the report can print.
    for (const f of json.findings) {
      if (f.source === "rls-sql" || f.source === "storage-acl") {
        assert.ok(f.path && f.path.length > 0, "schema finding needs a path");
      }
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("kelp scan reports schema checks as n/a when there are no migrations", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kelp-scan-nomig-"));
  try {
    await fs.writeFile(path.join(dir, "index.ts"), "export const x = 1;\n", "utf8");
    const { json } = await runScanJson(dir);
    assert.equal(json.checks.rlsSchema.applicable, false);
    assert.equal(json.checks.storageAcl.applicable, false);
    assert.equal(json.checks.rlsSchema.findings, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
