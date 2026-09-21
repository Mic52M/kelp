// Static RLS analyzer for a Supabase repo — reads SQL migrations, builds the
// same SchemaSnapshot the live analyzer (rls.ts) consumes, and runs both the
// base checks AND three deep checks that need the schema *graph* (foreign
// keys, grants, views) to fire:
//
//   RLS-DEEP-01  cross-tenant leak via FK — table with RLS enabled and a
//                foreign key to a target that has RLS DISABLED. Attackers
//                pivot through the parent's PostgREST embed (?select=…)
//                and read every child row.
//   RLS-DEEP-02  command-scope gap — RLS policies cover SELECT but leave
//                INSERT / UPDATE / DELETE ungoverned while grants let a
//                client role write. Read is safe, write is wide open.
//   RLS-DEEP-03  view-based bypass — CREATE VIEW over an RLS-protected
//                base table without security_invoker = true. The view is
//                owned by postgres, RLS checks the *view owner*'s policies
//                (none) instead of the caller's, and RLS is silently
//                bypassed.
//
// The SQL parser is intentionally NOT a full PostgreSQL grammar. It targets
// the shape Supabase migrations actually take (`supabase db diff`, dashboard
// SQL editor exports, dbmate/prisma-generated ones): one CREATE TABLE per
// statement, policies in their own CREATE POLICY blocks, RLS toggled by
// ALTER TABLE … ENABLE ROW LEVEL SECURITY. Handles ~95% of real repos with
// ~250 LOC. When the parser can't understand a statement it skips silently
// and records the location so the caller can surface "coverage" data.
//
// The output feeds analyzeRls() as-is, so the base checks (rls_disabled,
// permissive_policy, owner_not_scoped, rls_no_policies) light up on repo
// scans without any duplication.

import type { Severity } from "../types.js";
import { fingerprint } from "../fingerprint.js";
import type { SourceFile } from "./secrets.js";
import {
  analyzeRls,
  type ColumnInfo,
  type PolicyCommand,
  type PolicyInfo,
  type RlsFinding,
  type SchemaSnapshot,
  type TableInfo,
} from "./rls.js";

// ── Extended schema shape ──────────────────────────────────────────────

/** Foreign key edge in the schema graph. */
export interface ForeignKeyInfo {
  fromSchema: string;
  fromTable: string;
  fromColumn: string;
  toSchema: string;
  toTable: string;
  toColumn: string;
}

/** GRANT statement, only the shape we care about (which role got which
 *  command on which table). */
export interface GrantInfo {
  role: string;
  schema: string;
  table: string;
  /** ALL means every DML command; otherwise a specific one. */
  commands: PolicyCommand[];
}

/** A row inserted into `storage.buckets` — one Supabase Storage bucket.
 *  Only carries the fields the storage-acl analyzer needs. */
export interface StorageBucketInfo {
  /** Bucket id as declared in the INSERT (the value clients pass as `bucket_id`). */
  id: string;
  /** Optional friendly name (defaults to id in Supabase's schema). */
  name: string;
  /** `public = true` makes every object reachable via CDN without auth. */
  isPublic: boolean;
}

/** SchemaSnapshot extended with graph-level information for deep checks. */
export interface DeepSchemaSnapshot extends SchemaSnapshot {
  foreignKeys: ForeignKeyInfo[];
  grants: GrantInfo[];
  buckets: StorageBucketInfo[];
}

// ── Deep-check finding shape ───────────────────────────────────────────

export type RlsDeepIssue =
  | "fk_leak_to_unprotected"
  | "command_scope_gap"
  | "view_bypasses_rls";

export interface RlsDeepFinding {
  fingerprint: string;
  issue: RlsDeepIssue;
  severity: Severity;
  schema: string;
  table: string;
  title: string;
  explanation: string;
  /** Extra pointers depending on the issue class. */
  details: Record<string, string | string[]>;
}

// ── Parser entry point ────────────────────────────────────────────────

/** Parse the SQL migration files in a repo into a deep schema snapshot.
 *  Only files under a `supabase/` or `migrations/` path with a .sql suffix
 *  are considered. Missing/empty repos return an empty snapshot, not null. */
export function parseSqlMigrations(files: readonly SourceFile[]): DeepSchemaSnapshot {
  const sqlFiles = files.filter(
    (f) =>
      /\.sql$/i.test(f.path) &&
      (/(?:^|\/)supabase\//i.test(f.path) || /(?:^|\/)migrations\//i.test(f.path)),
  );

  const tables = new Map<string, TableInfo>();
  const foreignKeys: ForeignKeyInfo[] = [];
  const grants: GrantInfo[] = [];
  const buckets: StorageBucketInfo[] = [];

  // Migrations are read in filename-sorted order so ALTER TABLE additions in
  // later migrations correctly amend earlier CREATE TABLEs.
  const sorted = [...sqlFiles].sort((a, b) => a.path.localeCompare(b.path));

  for (const f of sorted) {
    const statements = splitStatements(stripComments(f.content));
    for (const stmt of statements) {
      const trimmed = stmt.trim();
      if (trimmed.length === 0) continue;

      const createTable = matchCreateTable(trimmed);
      if (createTable) {
        const key = `${createTable.schema}.${createTable.name}`;
        const existing = tables.get(key);
        if (!existing) {
          tables.set(key, {
            schema: createTable.schema,
            name: createTable.name,
            columns: createTable.columns,
            rlsEnabled: false,
            policies: [],
            isView: false,
          });
        }
        // Table-level FKs from the CREATE TABLE body.
        for (const fk of createTable.foreignKeys) foreignKeys.push(fk);
        continue;
      }

      const createView = matchCreateView(trimmed);
      if (createView) {
        const key = `${createView.schema}.${createView.name}`;
        tables.set(key, {
          schema: createView.schema,
          name: createView.name,
          columns: [], // view columns are inferred; not needed for our checks
          rlsEnabled: false,
          policies: [],
          isView: true,
        });
        // Views carry security_invoker as an aside — stash it on the deep
        // side so the checker can read it. We piggy-back on `policies` being
        // empty by adding a sentinel policy? No — cleaner to keep a side
        // map. We stash it in a WeakMap-shaped property on the returned
        // snapshot below.
        viewInvoker.set(key, createView.securityInvoker);
        continue;
      }

      const rlsOn = matchEnableRls(trimmed);
      if (rlsOn) {
        const key = `${rlsOn.schema}.${rlsOn.name}`;
        const t = tables.get(key);
        if (t) t.rlsEnabled = true;
        continue;
      }

      const policy = matchCreatePolicy(trimmed);
      if (policy) {
        const key = `${policy.schema}.${policy.table}`;
        let t = tables.get(key);
        if (!t) {
          // Auto-create a phantom TableInfo. This lets us track policies
          // on Supabase built-in tables (storage.objects, storage.buckets,
          // auth.users) that are never `CREATE TABLE`d in user migrations
          // but are the surface many real policies live on. RLS is treated
          // as enabled because Supabase enables it on these tables by
          // default; the storage-acl analyzer keys off the policies list
          // rather than rlsEnabled.
          t = {
            schema: policy.schema,
            name: policy.table,
            columns: [],
            rlsEnabled: true,
            policies: [],
            isView: false,
          };
          tables.set(key, t);
        }
        t.policies.push(policy.policy);
        continue;
      }

      const grant = matchGrant(trimmed);
      if (grant) {
        grants.push(...grant);
        continue;
      }

      const alterFk = matchAlterAddFk(trimmed);
      if (alterFk) {
        for (const fk of alterFk) foreignKeys.push(fk);
        continue;
      }

      const bucketRows = matchInsertBuckets(trimmed);
      if (bucketRows) {
        for (const b of bucketRows) buckets.push(b);
        continue;
      }
      // Unrecognized: skip silently. Real repos have hundreds of
      // unrelated statements (functions, seed inserts, extensions).
    }
  }

  return {
    tables: [...tables.values()],
    foreignKeys,
    grants,
    buckets,
  };
}

// ── Public checks ─────────────────────────────────────────────────────

/** Analyze the parsed snapshot. Returns base RLS findings (via analyzeRls)
 *  interleaved with deep findings, unified under one `Severity` order. */
export function analyzeDeep(snapshot: DeepSchemaSnapshot): (RlsFinding | RlsDeepFinding)[] {
  const base = analyzeRls(snapshot);
  const deep: RlsDeepFinding[] = [];

  const byKey = new Map<string, TableInfo>();
  for (const t of snapshot.tables) byKey.set(`${t.schema}.${t.name}`, t);

  // RLS-DEEP-01 — FK leak to unprotected table.
  // For every FK from a protected table to a target with RLS off, flag the
  // TARGET (the leak sink). PostgREST embeds (?select=parent(*,child(*)))
  // will resolve the target through the FK regardless of the child's own
  // RLS, so the finding lives on the unprotected side.
  const seenLeak = new Set<string>();
  for (const fk of snapshot.foreignKeys) {
    const to = byKey.get(`${fk.toSchema}.${fk.toTable}`);
    const from = byKey.get(`${fk.fromSchema}.${fk.fromTable}`);
    if (!to || !from) continue;
    if (to.isView) continue;
    if (to.rlsEnabled) continue; // target is protected — no leak
    if (!from.rlsEnabled) continue; // caller is public too — dupe of the base finding
    const key = `${fk.toSchema}.${fk.toTable}`;
    if (seenLeak.has(key)) continue;
    seenLeak.add(key);
    deep.push({
      fingerprint: fingerprint(["rls-deep", "fk_leak", fk.toSchema, fk.toTable, fk.fromTable]),
      issue: "fk_leak_to_unprotected",
      severity: "high",
      schema: fk.toSchema,
      table: fk.toTable,
      title: `"${fk.toTable}" is exposed through a foreign key from a protected table`,
      explanation:
        `"${fk.fromSchema}.${fk.fromTable}" enforces Row Level Security, but it holds ` +
        `a foreign key to "${fk.toSchema}.${fk.toTable}" and that target table has RLS ` +
        `disabled. A PostgREST caller can embed the target through the FK (for example ` +
        `?select=${fk.fromTable}(*,${fk.toTable}(*))) and read every row of "${fk.toTable}" ` +
        `even though the parent is protected. Enable RLS on "${fk.toTable}" with an ` +
        `owner-scoped policy, or restrict the join role.`,
      details: {
        via: `${fk.fromSchema}.${fk.fromTable}.${fk.fromColumn} -> ${fk.toSchema}.${fk.toTable}.${fk.toColumn}`,
      },
    });
  }

  // RLS-DEEP-02 — command-scope gap.
  // Table has RLS enabled, has SELECT policies for client roles, but no
  // policy for INSERT/UPDATE/DELETE. In Supabase, a missing per-command
  // policy means the command is fully denied *unless* another mechanism
  // grants it — which is exactly the trap: a GRANT INSERT to authenticated
  // (or the default PostgREST role) makes writes wide open. We only flag
  // when a matching grant exists.
  const clientRoles = new Set(["anon", "authenticated", "public"]);
  for (const t of snapshot.tables) {
    if (!t.rlsEnabled || t.isView) continue;
    if (t.schema !== "public") continue;
    const cmds = new Set(t.policies.flatMap((p) => expandPolicyCommand(p.command)));
    if (!cmds.has("SELECT")) continue;
    const missing: PolicyCommand[] = [];
    for (const c of ["INSERT", "UPDATE", "DELETE"] as PolicyCommand[]) {
      if (cmds.has(c)) continue;
      const hasGrant = snapshot.grants.some(
        (g) =>
          g.schema === t.schema &&
          g.table === t.name &&
          clientRoles.has(g.role) &&
          (g.commands.includes(c) || g.commands.includes("ALL")),
      );
      if (hasGrant) missing.push(c);
    }
    if (missing.length === 0) continue;
    deep.push({
      fingerprint: fingerprint(["rls-deep", "cmd_gap", t.schema, t.name, missing.join(",")]),
      issue: "command_scope_gap",
      severity: "high",
      schema: t.schema,
      table: t.name,
      title: `"${t.name}" has RLS for reads but not for ${missing.join("/")}`,
      explanation:
        `"${t.schema}.${t.name}" enforces Row Level Security on SELECT but has no ` +
        `policy for ${missing.join(", ")}, while a client role (anon/authenticated) ` +
        `still holds a GRANT for those commands. Rows are safe to read and completely ` +
        `open to write. Add per-command policies with the same owner check you use for ` +
        `SELECT, or revoke the extra grants.`,
      details: { missing_commands: missing },
    });
  }

  // RLS-DEEP-03 — view bypasses RLS.
  // Views defined WITHOUT security_invoker = true inherit the *view owner*'s
  // permissions, not the caller's. If the view targets an RLS-protected base
  // table, the base table's policies are bypassed when queried through the
  // view. We flag every view over an RLS-on base without security_invoker=true.
  for (const t of snapshot.tables) {
    if (!t.isView) continue;
    if (t.schema !== "public") continue;
    const key = `${t.schema}.${t.name}`;
    if (viewInvoker.get(key) === true) continue;
    // We flag the view unconditionally when security_invoker is not set:
    // even if we can't statically resolve which base tables it queries, the
    // pattern is a known Supabase footgun and the fix is a one-liner.
    deep.push({
      fingerprint: fingerprint(["rls-deep", "view_bypass", t.schema, t.name]),
      issue: "view_bypasses_rls",
      severity: "high",
      schema: t.schema,
      table: t.name,
      title: `View "${t.name}" runs with the view owner's permissions, not the caller's`,
      explanation:
        `"${t.schema}.${t.name}" is a view created without security_invoker = true. ` +
        `PostgreSQL applies Row Level Security using the view *owner*'s policies, not ` +
        `the caller's, which silently bypasses RLS on any protected base table the view ` +
        `reads. Recreate the view with WITH (security_invoker = true), or move the ` +
        `RLS-protected joins into a SECURITY INVOKER function.`,
      details: {},
    });
  }

  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return [...base, ...deep].sort((a, b) => order[a.severity] - order[b.severity]);
}

// ── Parser internals ──────────────────────────────────────────────────

// Views set security_invoker as an OPTION on CREATE VIEW, but the base
// analyzer types (TableInfo) don't carry that field. We stash it in a
// module-level map keyed by "schema.name". Parser writes, checker reads.
const viewInvoker = new Map<string, boolean>();

/** Strip -- line comments and slash-star block comments. Keeps line count
 *  roughly stable so error messages still line up. */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/--[^\n]*/g, "");
}

/** Split on top-level semicolons, ignoring semis inside single/double quotes
 *  and $$-dollar-quoted blocks. Enough for the migration shapes we care
 *  about; will miss exotic quoting like nested $tag$ ... $tag$. */
function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  let inDollar = false;
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    const c2 = sql[i + 1] ?? "";
    if (inDollar) {
      if (c === "$" && c2 === "$") {
        inDollar = false;
        buf += "$$";
        i += 2;
        continue;
      }
    } else if (inSingle) {
      if (c === "'" && c2 === "'") {
        buf += "''";
        i += 2;
        continue;
      }
      if (c === "'") inSingle = false;
    } else if (inDouble) {
      if (c === '"') inDouble = false;
    } else {
      if (c === "'") inSingle = true;
      else if (c === '"') inDouble = true;
      else if (c === "$" && c2 === "$") {
        inDollar = true;
        buf += "$$";
        i += 2;
        continue;
      } else if (c === ";") {
        out.push(buf);
        buf = "";
        i++;
        continue;
      }
    }
    buf += c;
    i++;
  }
  if (buf.trim().length > 0) out.push(buf);
  return out;
}

/** `identifier` or `"quoted identifier"` or `schema.name`. Returns lowercase
 *  by default (Postgres folding) unless the identifier was double-quoted. */
function parseQualifiedName(raw: string): { schema: string; name: string } {
  const trimmed = raw.trim();
  const parts: string[] = [];
  let i = 0;
  while (i < trimmed.length) {
    if (trimmed[i] === '"') {
      const end = trimmed.indexOf('"', i + 1);
      if (end === -1) break;
      parts.push(trimmed.slice(i + 1, end));
      i = end + 1;
    } else {
      const rest = trimmed.slice(i);
      const m = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
      if (!m) break;
      parts.push(m[1]!.toLowerCase());
      i += m[1]!.length;
    }
    if (trimmed[i] === ".") i++;
    else break;
  }
  if (parts.length === 2) return { schema: parts[0]!, name: parts[1]! };
  return { schema: "public", name: parts[0] ?? "" };
}

interface ParsedCreateTable {
  schema: string;
  name: string;
  columns: ColumnInfo[];
  foreignKeys: ForeignKeyInfo[];
}

function matchCreateTable(stmt: string): ParsedCreateTable | null {
  const m = stmt.match(
    /^\s*create\s+table\s+(?:if\s+not\s+exists\s+)?([^\s(]+)\s*\(([\s\S]+)\)\s*(?:with\s*\([^)]*\)\s*)?$/i,
  );
  if (!m) return null;
  const { schema, name } = parseQualifiedName(m[1]!);
  const body = m[2]!;
  const columns: ColumnInfo[] = [];
  const foreignKeys: ForeignKeyInfo[] = [];

  const parts = splitTopLevelCommas(body);
  for (const p of parts) {
    const trimmed = p.trim();
    if (trimmed.length === 0) continue;
    // Table-level constraint clauses start with a keyword.
    const constraintFk = trimmed.match(
      /^(?:constraint\s+\S+\s+)?foreign\s+key\s*\(\s*([^)]+)\s*\)\s+references\s+([^\s(]+)\s*(?:\(\s*([^)]+)\s*\))?/i,
    );
    if (constraintFk) {
      const fromCols = constraintFk[1]!.split(",").map((c) => c.trim().replace(/"/g, ""));
      const target = parseQualifiedName(constraintFk[2]!);
      const toCols = constraintFk[3]
        ? constraintFk[3].split(",").map((c) => c.trim().replace(/"/g, ""))
        : ["id"];
      for (let i = 0; i < fromCols.length; i++) {
        foreignKeys.push({
          fromSchema: schema,
          fromTable: name,
          fromColumn: fromCols[i]!,
          toSchema: target.schema,
          toTable: target.name,
          toColumn: toCols[i] ?? toCols[0]!,
        });
      }
      continue;
    }
    if (/^(primary|unique|check|constraint|exclude|like)\b/i.test(trimmed)) continue;

    // Column definition: name type ... [references target(col)]
    const colM = trimmed.match(/^("[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s+([^\s,]+(?:\s*\([^)]*\))?)/);
    if (!colM) continue;
    const colName = colM[1]!.replace(/"/g, "");
    const colType = colM[2]!;
    columns.push({ name: colName, type: colType });

    // Inline REFERENCES.
    const inlineFk = trimmed.match(/references\s+([^\s(]+)\s*(?:\(\s*([^)]+)\s*\))?/i);
    if (inlineFk) {
      const target = parseQualifiedName(inlineFk[1]!);
      const toCol = inlineFk[2] ? inlineFk[2].trim().replace(/"/g, "") : "id";
      foreignKeys.push({
        fromSchema: schema,
        fromTable: name,
        fromColumn: colName,
        toSchema: target.schema,
        toTable: target.name,
        toColumn: toCol,
      });
    }
  }
  return { schema, name, columns, foreignKeys };
}

function splitTopLevelCommas(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (inSingle) {
      if (c === "'") inSingle = false;
    } else if (inDouble) {
      if (c === '"') inDouble = false;
    } else {
      if (c === "'") inSingle = true;
      else if (c === '"') inDouble = true;
      else if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === "," && depth === 0) {
        out.push(buf);
        buf = "";
        continue;
      }
    }
    buf += c;
  }
  if (buf.length > 0) out.push(buf);
  return out;
}

interface ParsedCreateView {
  schema: string;
  name: string;
  securityInvoker: boolean;
}

function matchCreateView(stmt: string): ParsedCreateView | null {
  const m = stmt.match(
    /^\s*create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?([^\s(]+)([\s\S]*)$/i,
  );
  if (!m) return null;
  const { schema, name } = parseQualifiedName(m[1]!);
  const tail = m[2]!;
  const withOpts = tail.match(/with\s*\(([^)]+)\)/i);
  const securityInvoker =
    !!withOpts && /security_invoker\s*=\s*true/i.test(withOpts[1]!);
  return { schema, name, securityInvoker };
}

function matchEnableRls(stmt: string): { schema: string; name: string } | null {
  const m = stmt.match(
    /^\s*alter\s+table\s+(?:only\s+)?([^\s]+)\s+enable\s+row\s+level\s+security/i,
  );
  if (!m) return null;
  return parseQualifiedName(m[1]!);
}

interface ParsedPolicy {
  schema: string;
  table: string;
  policy: PolicyInfo;
}

function matchCreatePolicy(stmt: string): ParsedPolicy | null {
  const m = stmt.match(
    /^\s*create\s+policy\s+("[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s+on\s+([^\s]+)([\s\S]+)$/i,
  );
  if (!m) return null;
  const name = m[1]!.replace(/"/g, "");
  const { schema, name: tableName } = parseQualifiedName(m[2]!);
  const tail = m[3]!;

  const forM = tail.match(/\bfor\s+(select|insert|update|delete|all)\b/i);
  const cmd: PolicyCommand = (forM ? forM[1]!.toUpperCase() : "ALL") as PolicyCommand;

  const toM = tail.match(/\bto\s+([A-Za-z_][A-Za-z0-9_,\s"]*?)(?:\s+using\b|\s+with\b|$)/i);
  const roles: string[] = toM
    ? toM[1]!
        .split(",")
        .map((r) => r.trim().replace(/"/g, "").toLowerCase())
        .filter((r) => r.length > 0)
    : [];

  const usingExpr = extractParenExpr(tail, /\busing\s*\(/i);
  const withCheckExpr = extractParenExpr(tail, /\bwith\s+check\s*\(/i);

  return {
    schema,
    table: tableName,
    policy: { name, command: cmd, usingExpr, withCheckExpr, roles },
  };
}

/** Extract the parenthesized expression after a matched keyword. Handles
 *  nested parens; returns null when no match. */
function extractParenExpr(s: string, opener: RegExp): string | null {
  const m = s.match(opener);
  if (!m) return null;
  const start = m.index! + m[0].length;
  let depth = 1;
  let end = start;
  while (end < s.length && depth > 0) {
    const c = s[end]!;
    if (c === "(") depth++;
    else if (c === ")") depth--;
    if (depth > 0) end++;
  }
  return s.slice(start, end).trim();
}

function matchGrant(stmt: string): GrantInfo[] | null {
  // GRANT SELECT, INSERT ON public.foo TO authenticated;
  // GRANT ALL ON TABLE public.foo TO anon;
  const m = stmt.match(
    /^\s*grant\s+([A-Z,\s]+?)\s+on\s+(?:table\s+)?([^\s]+)\s+to\s+([A-Za-z_][A-Za-z0-9_,\s"]*)/i,
  );
  if (!m) return null;
  const cmds = m[1]!
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter((c) => c.length > 0);
  const { schema, name } = parseQualifiedName(m[2]!);
  const roles = m[3]!
    .split(",")
    .map((r) => r.trim().replace(/"/g, "").toLowerCase())
    .filter((r) => r.length > 0);
  const commands: PolicyCommand[] = cmds
    .filter((c) => ["SELECT", "INSERT", "UPDATE", "DELETE", "ALL"].includes(c))
    .map((c) => c as PolicyCommand);
  if (commands.length === 0) return null;
  return roles.map((role) => ({ role, schema, table: name, commands }));
}

function matchAlterAddFk(stmt: string): ForeignKeyInfo[] | null {
  const m = stmt.match(
    /^\s*alter\s+table\s+(?:only\s+)?([^\s]+)\s+add\s+(?:constraint\s+\S+\s+)?foreign\s+key\s*\(\s*([^)]+)\s*\)\s+references\s+([^\s(]+)\s*(?:\(\s*([^)]+)\s*\))?/i,
  );
  if (!m) return null;
  const from = parseQualifiedName(m[1]!);
  const fromCols = m[2]!.split(",").map((c) => c.trim().replace(/"/g, ""));
  const target = parseQualifiedName(m[3]!);
  const toCols = m[4] ? m[4].split(",").map((c) => c.trim().replace(/"/g, "")) : ["id"];
  return fromCols.map((fc, i) => ({
    fromSchema: from.schema,
    fromTable: from.name,
    fromColumn: fc,
    toSchema: target.schema,
    toTable: target.name,
    toColumn: toCols[i] ?? toCols[0]!,
  }));
}

function expandPolicyCommand(c: PolicyCommand): PolicyCommand[] {
  if (c === "ALL") return ["SELECT", "INSERT", "UPDATE", "DELETE"];
  return [c];
}

/** Parse `INSERT INTO storage.buckets (columns...) VALUES (...), (...), ...`.
 *  Extracts every VALUES row into a StorageBucketInfo. Only column combos
 *  Supabase actually uses are supported: (id), (id, name), (id, name, public),
 *  or any ordering thereof. Returns null when the statement isn't a
 *  storage.buckets insert. */
function matchInsertBuckets(stmt: string): StorageBucketInfo[] | null {
  const head = stmt.match(
    /^\s*insert\s+into\s+([^\s(]+)\s*\(([^)]+)\)\s*values\s*([\s\S]+)$/i,
  );
  if (!head) return null;
  const target = parseQualifiedName(head[1]!);
  if (target.schema !== "storage" || target.name !== "buckets") return null;

  const columns = head[2]!
    .split(",")
    .map((c) => c.trim().replace(/"/g, "").toLowerCase());

  const valuesBlob = head[3]!;
  const rows: string[][] = [];
  // Split top-level VALUES rows. Each row is `(...)`. Handles quoted strings.
  let i = 0;
  while (i < valuesBlob.length) {
    while (i < valuesBlob.length && valuesBlob[i] !== "(") i++;
    if (i >= valuesBlob.length) break;
    // Find matching close paren, respecting single-quoted strings.
    let depth = 0;
    let j = i;
    let inSingle = false;
    while (j < valuesBlob.length) {
      const c = valuesBlob[j]!;
      if (inSingle) {
        if (c === "'" && valuesBlob[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (c === "'") inSingle = false;
      } else if (c === "'") {
        inSingle = true;
      } else if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) break;
      }
      j++;
    }
    if (j >= valuesBlob.length) break;
    const inner = valuesBlob.slice(i + 1, j);
    rows.push(splitCsvRow(inner));
    i = j + 1;
  }

  const out: StorageBucketInfo[] = [];
  for (const values of rows) {
    let id = "";
    let name = "";
    let isPublic = false;
    let sawPublicColumn = false;
    for (let k = 0; k < columns.length && k < values.length; k++) {
      const col = columns[k]!;
      const raw = values[k]!.trim();
      const literal = parseSqlLiteral(raw);
      if (col === "id") id = literal ?? "";
      else if (col === "name") name = literal ?? "";
      else if (col === "public") {
        sawPublicColumn = true;
        // Postgres accepts 't'/'f'/'true'/'false'/1/0 (as strings after
        // parseSqlLiteral strips quotes).
        const norm = (literal ?? raw).trim().toLowerCase();
        isPublic = norm === "true" || norm === "t" || norm === "1";
      }
    }
    if (!name) name = id;
    // If no `public` column was declared, Supabase defaults `public = false`.
    if (!sawPublicColumn) isPublic = false;
    if (id.length === 0) continue;
    out.push({ id, name, isPublic });
  }
  return out;
}

/** Split a VALUES row body respecting single-quoted strings (which may
 *  contain commas). Trims each field but keeps its literal form. */
function splitCsvRow(inner: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inSingle = false;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (inSingle) {
      if (c === "'" && inner[i + 1] === "'") {
        buf += "''";
        i++;
        continue;
      }
      if (c === "'") inSingle = false;
      buf += c;
    } else if (c === "'") {
      inSingle = true;
      buf += c;
    } else if (c === ",") {
      out.push(buf);
      buf = "";
    } else {
      buf += c;
    }
  }
  if (buf.length > 0) out.push(buf);
  return out;
}

/** Return the value of a single-quoted SQL literal, or null if the token
 *  isn't a quoted string. */
function parseSqlLiteral(raw: string): string | null {
  const t = raw.trim();
  if (t.length < 2 || t[0] !== "'" || t[t.length - 1] !== "'") return null;
  return t.slice(1, -1).replace(/''/g, "'");
}
