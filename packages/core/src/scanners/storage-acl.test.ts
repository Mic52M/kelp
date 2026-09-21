// Storage ACL analyzer tests. VULN/CONTROL pair for each of the three
// rules, plus a parser-integration test that a real INSERT INTO
// storage.buckets round-trips through parseSqlMigrations correctly.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SourceFile } from "./secrets.js";
import { parseSqlMigrations } from "./rls-sql.js";
import { analyzeStorageAcl } from "./storage-acl.js";

function sql(name: string, content: string): SourceFile {
  return { path: `supabase/migrations/${name}`, content };
}

// ── parser: storage.buckets INSERT ─────────────────────────────────────

test("parser reads (id, name, public) rows out of INSERT INTO storage.buckets", () => {
  const snap = parseSqlMigrations([
    sql(
      "1.sql",
      `insert into storage.buckets (id, name, public) values
         ('avatars', 'avatars', true),
         ('documents', 'private documents', false);`,
    ),
  ]);
  assert.equal(snap.buckets.length, 2);
  const avatars = snap.buckets.find((b) => b.id === "avatars")!;
  const docs = snap.buckets.find((b) => b.id === "documents")!;
  assert.equal(avatars.isPublic, true);
  assert.equal(docs.isPublic, false);
  assert.equal(docs.name, "private documents");
});

test("parser handles (id) shorthand and defaults public to false", () => {
  const snap = parseSqlMigrations([
    sql("1.sql", `insert into storage.buckets (id) values ('x'), ('y');`),
  ]);
  assert.equal(snap.buckets.length, 2);
  for (const b of snap.buckets) {
    assert.equal(b.isPublic, false, "public must default to false");
    assert.equal(b.name, b.id, "name must default to id");
  }
});

// ── STORAGE-01 · public bucket ─────────────────────────────────────────

test("STORAGE-01 VULN: bucket with public = true fires", () => {
  const snap = parseSqlMigrations([
    sql(
      "1.sql",
      `insert into storage.buckets (id, name, public) values ('leak', 'leak', true);`,
    ),
  ]);
  const findings = analyzeStorageAcl(snap);
  const f = findings.find((x) => x.issue === "storage_public_bucket");
  assert.ok(f, "public bucket must fire");
  assert.equal(f!.severity, "high");
  assert.equal(f!.bucketId, "leak");
});

test("STORAGE-01 CONTROL: private bucket does not fire the public-bucket rule", () => {
  const snap = parseSqlMigrations([
    sql(
      "1.sql",
      `insert into storage.buckets (id, name, public) values ('private-docs', 'private-docs', false);`,
    ),
  ]);
  const findings = analyzeStorageAcl(snap);
  assert.equal(findings.filter((f) => f.issue === "storage_public_bucket").length, 0);
});

// ── STORAGE-02 · bucket-scoped but not user-scoped ─────────────────────

test("STORAGE-02 VULN: policy filters on bucket_id but never references the user", () => {
  const snap = parseSqlMigrations([
    sql(
      "1.sql",
      `create policy read_bucket_only on storage.objects
         for select to authenticated
         using (bucket_id = 'shared-files');`,
    ),
  ]);
  const findings = analyzeStorageAcl(snap);
  const f = findings.find((x) => x.issue === "storage_policy_missing_user_scope");
  assert.ok(f, "missing-user-scope must fire");
  assert.equal(f!.bucketId, "shared-files");
  assert.equal(f!.policyName, "read_bucket_only");
});

test("STORAGE-02 CONTROL: policy scopes to bucket AND user via foldername(name) → silent", () => {
  const snap = parseSqlMigrations([
    sql(
      "1.sql",
      `create policy read_own on storage.objects
         for select to authenticated
         using (
           bucket_id = 'user-files'
           and auth.uid()::text = (storage.foldername(name))[1]
         );`,
    ),
  ]);
  const findings = analyzeStorageAcl(snap);
  assert.equal(
    findings.filter((f) => f.issue === "storage_policy_missing_user_scope").length,
    0,
    "user-scoped policy must not fire the missing-scope rule",
  );
});

test("STORAGE-02 CONTROL: policy scopes to bucket AND uses owner = auth.uid() → silent", () => {
  const snap = parseSqlMigrations([
    sql(
      "1.sql",
      `create policy own_only on storage.objects
         for select to authenticated
         using (bucket_id = 'attachments' and owner = auth.uid());`,
    ),
  ]);
  const findings = analyzeStorageAcl(snap);
  assert.equal(
    findings.filter((f) => f.issue === "storage_policy_missing_user_scope").length,
    0,
  );
});

// ── STORAGE-03 · permissive policy ─────────────────────────────────────

test("STORAGE-03 VULN: USING (true) policy on storage.objects for authenticated fires as critical", () => {
  const snap = parseSqlMigrations([
    sql(
      "1.sql",
      `create policy everything on storage.objects
         for all to authenticated
         using (true) with check (true);`,
    ),
  ]);
  const findings = analyzeStorageAcl(snap);
  const f = findings.find((x) => x.issue === "storage_policy_permissive");
  assert.ok(f, "permissive policy must fire");
  assert.equal(f!.severity, "critical");
  assert.equal(f!.policyName, "everything");
});

test("STORAGE-03 CONTROL: USING (true) restricted to service_role → silent", () => {
  const snap = parseSqlMigrations([
    sql(
      "1.sql",
      `create policy internal_all on storage.objects
         for all to service_role
         using (true);`,
    ),
  ]);
  const findings = analyzeStorageAcl(snap);
  assert.equal(
    findings.filter((f) => f.issue === "storage_policy_permissive").length,
    0,
    "permissive-for-service_role is expected and safe",
  );
});

// ── STORAGE-03 dominates STORAGE-02 (no double count) ──────────────────

test("A permissive policy dominates: STORAGE-02 does not also fire on the same policy", () => {
  const snap = parseSqlMigrations([
    sql(
      "1.sql",
      `create policy loose on storage.objects
         for select to authenticated
         using (bucket_id = 'x' and true);`,
    ),
  ]);
  // Not permissive per our normalizer (the full expression contains
  // bucket_id, not just `true`), so STORAGE-02 fires cleanly. This test
  // pins that we don't accidentally double-classify.
  const findings = analyzeStorageAcl(snap);
  const named = findings.filter((f) => f.policyName === "loose");
  assert.equal(named.length, 1, "one finding per policy, no double counting");
  assert.equal(named[0]!.issue, "storage_policy_missing_user_scope");
});

// ── fingerprints + ordering ────────────────────────────────────────────

test("findings are severity-ordered (critical → high)", () => {
  const snap = parseSqlMigrations([
    sql(
      "1.sql",
      `insert into storage.buckets (id, name, public) values ('p', 'p', true);
       create policy everything on storage.objects for all to authenticated
         using (true);`,
    ),
  ]);
  const findings = analyzeStorageAcl(snap);
  assert.ok(findings.length >= 2);
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  for (let i = 1; i < findings.length; i++) {
    assert.ok(order[findings[i - 1]!.severity] <= order[findings[i]!.severity]);
  }
});

test("fingerprints are stable across re-scans", () => {
  const files = [
    sql(
      "1.sql",
      `insert into storage.buckets (id, name, public) values ('p', 'p', true);
       create policy loose on storage.objects for select to authenticated
         using (bucket_id = 'p');`,
    ),
  ];
  const a = analyzeStorageAcl(parseSqlMigrations(files)).map((f) => f.fingerprint);
  const b = analyzeStorageAcl(parseSqlMigrations(files)).map((f) => f.fingerprint);
  assert.deepEqual(a, b);
});
