// Tests for the static RLS analyzer. Every deep check has a VULN fixture
// that MUST fire and a CONTROL fixture that MUST stay silent — the same
// discipline the kelp-corpus benchmark uses. Base checks are covered here
// too via a small end-to-end migration that exercises the parser.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SourceFile } from "./secrets.js";
import { parseSqlMigrations, analyzeDeep, type RlsDeepFinding } from "./rls-sql.js";
import type { RlsFinding } from "./rls.js";

function sql(name: string, content: string): SourceFile {
  return { path: `supabase/migrations/${name}`, content };
}

function isDeep(f: RlsFinding | RlsDeepFinding): f is RlsDeepFinding {
  return (f as RlsDeepFinding).details !== undefined;
}

// ── parser sanity ─────────────────────────────────────────────────────

test("parser extracts tables, columns, RLS status, policies, grants, FKs", () => {
  const files: SourceFile[] = [
    sql(
      "20250101_init.sql",
      `
      create table public.users (
        id uuid primary key,
        email text not null
      );

      create table public.posts (
        id uuid primary key,
        author_id uuid references public.users (id),
        body text
      );

      alter table public.users enable row level security;
      alter table public.posts enable row level security;

      create policy users_self on public.users
        for select to authenticated
        using (auth.uid() = id);

      grant select, insert, update on public.posts to authenticated;
      `,
    ),
  ];
  const snapshot = parseSqlMigrations(files);
  assert.equal(snapshot.tables.length, 2);
  const users = snapshot.tables.find((t) => t.name === "users")!;
  const posts = snapshot.tables.find((t) => t.name === "posts")!;
  assert.equal(users.rlsEnabled, true);
  assert.equal(posts.rlsEnabled, true);
  assert.equal(users.policies.length, 1);
  assert.equal(users.policies[0]!.command, "SELECT");
  assert.ok(users.policies[0]!.roles.includes("authenticated"));
  assert.equal(snapshot.foreignKeys.length, 1);
  assert.equal(snapshot.foreignKeys[0]!.toTable, "users");
  assert.equal(snapshot.foreignKeys[0]!.fromColumn, "author_id");
  assert.ok(
    snapshot.grants.some(
      (g) => g.table === "posts" && g.role === "authenticated" && g.commands.includes("INSERT"),
    ),
  );
});

test("parser ignores non-migration folders and non-.sql files", () => {
  const snapshot = parseSqlMigrations([
    { path: "src/app.sql", content: "create table foo();" },
    { path: "supabase/migrations/readme.md", content: "not sql" },
    { path: "supabase/migrations/1.sql", content: "create table public.x (id uuid);" },
  ]);
  assert.equal(snapshot.tables.length, 1);
  assert.equal(snapshot.tables[0]!.name, "x");
});

test("parser handles ALTER TABLE ADD FOREIGN KEY separately from CREATE TABLE", () => {
  const snapshot = parseSqlMigrations([
    sql(
      "1_tables.sql",
      `create table public.a (id uuid primary key);
       create table public.b (id uuid primary key, a_id uuid);`,
    ),
    sql(
      "2_fks.sql",
      `alter table public.b add constraint fk_b_a foreign key (a_id) references public.a (id);`,
    ),
  ]);
  assert.equal(snapshot.foreignKeys.length, 1);
  const fk = snapshot.foreignKeys[0]!;
  assert.equal(fk.fromTable, "b");
  assert.equal(fk.toTable, "a");
});

// ── base checks flow through analyzeDeep (no regression) ─────────────

test("base check: RLS disabled on public table fires as critical", () => {
  const snapshot = parseSqlMigrations([
    sql("1.sql", `create table public.notes (id uuid primary key, user_id uuid);`),
  ]);
  const findings = analyzeDeep(snapshot);
  const base = findings.filter((f) => !isDeep(f)) as RlsFinding[];
  assert.ok(base.some((f) => f.issue === "rls_disabled" && f.table === "notes"));
});

// ── RLS-DEEP-01 · FK leak to unprotected table ───────────────────────

test("RLS-DEEP-01 VULN: FK from protected posts to unprotected profiles fires", () => {
  const snapshot = parseSqlMigrations([
    sql(
      "1.sql",
      `create table public.profiles (id uuid primary key, ssn text);

       create table public.posts (
         id uuid primary key,
         author_id uuid references public.profiles (id)
       );

       alter table public.posts enable row level security;
       create policy p_own on public.posts for select to authenticated
         using (auth.uid() = author_id);`,
    ),
  ]);
  const findings = analyzeDeep(snapshot);
  const deep = findings.filter(isDeep);
  const leak = deep.find((f) => f.issue === "fk_leak_to_unprotected");
  assert.ok(leak, "fk_leak_to_unprotected must fire");
  assert.equal(leak!.table, "profiles");
  assert.equal(leak!.severity, "high");
});

test("RLS-DEEP-01 CONTROL: FK where both tables have RLS on → no leak finding", () => {
  const snapshot = parseSqlMigrations([
    sql(
      "1.sql",
      `create table public.profiles (id uuid primary key, ssn text);
       create table public.posts (id uuid primary key, author_id uuid references public.profiles (id));

       alter table public.profiles enable row level security;
       alter table public.posts enable row level security;

       create policy pr_own on public.profiles for select to authenticated using (auth.uid() = id);
       create policy po_own on public.posts for select to authenticated using (auth.uid() = author_id);`,
    ),
  ]);
  const findings = analyzeDeep(snapshot);
  const deep = findings.filter(isDeep);
  assert.equal(
    deep.filter((f) => f.issue === "fk_leak_to_unprotected").length,
    0,
    "leak must NOT fire when target is protected",
  );
});

// ── RLS-DEEP-02 · command scope gap ───────────────────────────────────

test("RLS-DEEP-02 VULN: SELECT policy but grants let INSERT/UPDATE through ungoverned", () => {
  const snapshot = parseSqlMigrations([
    sql(
      "1.sql",
      `create table public.orders (id uuid primary key, user_id uuid);
       alter table public.orders enable row level security;
       create policy read_own on public.orders for select to authenticated
         using (auth.uid() = user_id);
       grant select, insert, update on public.orders to authenticated;`,
    ),
  ]);
  const findings = analyzeDeep(snapshot);
  const deep = findings.filter(isDeep);
  const gap = deep.find((f) => f.issue === "command_scope_gap");
  assert.ok(gap, "command_scope_gap must fire");
  const missing = gap!.details.missing_commands as string[];
  assert.ok(missing.includes("INSERT") && missing.includes("UPDATE"));
});

test("RLS-DEEP-02 CONTROL: policies cover every granted command → silent", () => {
  const snapshot = parseSqlMigrations([
    sql(
      "1.sql",
      `create table public.orders (id uuid primary key, user_id uuid);
       alter table public.orders enable row level security;
       create policy read_own on public.orders for select to authenticated using (auth.uid() = user_id);
       create policy write_own on public.orders for insert to authenticated with check (auth.uid() = user_id);
       create policy update_own on public.orders for update to authenticated using (auth.uid() = user_id);
       grant select, insert, update on public.orders to authenticated;`,
    ),
  ]);
  const findings = analyzeDeep(snapshot);
  const deep = findings.filter(isDeep);
  assert.equal(
    deep.filter((f) => f.issue === "command_scope_gap").length,
    0,
    "command_scope_gap must NOT fire when all granted commands have policies",
  );
});

test("RLS-DEEP-02 CONTROL: no client grants at all → no finding even if only SELECT policy exists", () => {
  const snapshot = parseSqlMigrations([
    sql(
      "1.sql",
      `create table public.orders (id uuid primary key, user_id uuid);
       alter table public.orders enable row level security;
       create policy read_own on public.orders for select to authenticated using (auth.uid() = user_id);
       grant select on public.orders to authenticated;`,
    ),
  ]);
  const findings = analyzeDeep(snapshot);
  const deep = findings.filter(isDeep);
  assert.equal(deep.filter((f) => f.issue === "command_scope_gap").length, 0);
});

// ── RLS-DEEP-03 · view bypasses RLS ────────────────────────────────────

test("RLS-DEEP-03 VULN: CREATE VIEW without security_invoker over RLS-protected base fires", () => {
  const snapshot = parseSqlMigrations([
    sql(
      "1.sql",
      `create table public.contracts (id uuid primary key, user_id uuid, amount numeric);
       alter table public.contracts enable row level security;
       create policy own on public.contracts for select to authenticated using (auth.uid() = user_id);
       create view public.contracts_summary as
         select user_id, sum(amount) from public.contracts group by user_id;`,
    ),
  ]);
  const findings = analyzeDeep(snapshot);
  const deep = findings.filter(isDeep);
  const bypass = deep.find((f) => f.issue === "view_bypasses_rls");
  assert.ok(bypass, "view_bypasses_rls must fire");
  assert.equal(bypass!.table, "contracts_summary");
});

test("RLS-DEEP-03 CONTROL: CREATE VIEW WITH (security_invoker = true) → silent", () => {
  const snapshot = parseSqlMigrations([
    sql(
      "1.sql",
      `create table public.contracts (id uuid primary key, user_id uuid, amount numeric);
       alter table public.contracts enable row level security;
       create view public.contracts_summary with (security_invoker = true) as
         select user_id, sum(amount) from public.contracts group by user_id;`,
    ),
  ]);
  const findings = analyzeDeep(snapshot);
  const deep = findings.filter(isDeep);
  assert.equal(deep.filter((f) => f.issue === "view_bypasses_rls").length, 0);
});

// ── overall: ordering + fingerprints ─────────────────────────────────

test("findings are severity-ordered (critical, high, medium, low)", () => {
  const snapshot = parseSqlMigrations([
    sql(
      "1.sql",
      `create table public.notes (id uuid primary key, user_id uuid); -- RLS off, critical
       create table public.profiles (id uuid primary key);
       create table public.posts (id uuid primary key, author_id uuid references public.profiles (id));
       alter table public.posts enable row level security;
       create policy p_own on public.posts for select to authenticated using (auth.uid() = author_id);`,
    ),
  ]);
  const findings = analyzeDeep(snapshot);
  const sevs = findings.map((f) => f.severity);
  for (let i = 1; i < sevs.length; i++) {
    const prev = sevs[i - 1]!;
    const cur = sevs[i]!;
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    assert.ok(
      order[prev] <= order[cur],
      `findings must be severity-ordered, got ${prev} before ${cur}`,
    );
  }
});

test("fingerprints are stable across re-scans of the same migration set", () => {
  const files: SourceFile[] = [
    sql(
      "1.sql",
      `create table public.notes (id uuid primary key, user_id uuid);
       create table public.profiles (id uuid primary key);
       create table public.posts (id uuid primary key, author_id uuid references public.profiles (id));
       alter table public.posts enable row level security;`,
    ),
  ];
  const a = analyzeDeep(parseSqlMigrations(files)).map((f) => f.fingerprint);
  const b = analyzeDeep(parseSqlMigrations(files)).map((f) => f.fingerprint);
  assert.deepEqual(a, b);
});
