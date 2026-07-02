// Deterministic Row-Level-Security analyzer for Supabase/Postgres schemas.
//
// Input is a schema snapshot as we'd read it from the Supabase Management API /
// pg_catalog (tables, columns, whether RLS is enabled, and existing policies).
// Pure logic, no I/O — so it is fully unit-testable without a live project.
//
// What it flags (the real, high-precision dangers for vibe-coded Supabase apps):
//   A. RLS DISABLED on a table exposed through the API (schema `public`).
//      → anyone with the anon key can read/write every row. Critical.
//   B. A PERMISSIVE policy — USING (true) / WITH CHECK (true) — on a table that
//      has an ownership column. → rows are not scoped to their owner. Critical.
//   C. RLS enabled + ownership column present, but no policy references the
//      owner via auth.uid(). → rows likely not owner-scoped. High.
//   D. RLS enabled but NO policies at all. → default-deny (fail closed): not a
//      breach, but usually a misconfiguration. Low (informational).
//
// It also infers the fix: when an ownership column exists we can generate the
// standard owner-scoped policy as a proposed migration (see generateRlsMigration).

import type { Severity } from "../types.js";
import { fingerprint } from "../fingerprint.js";

export type PolicyCommand = "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL";

export interface PolicyInfo {
  name: string;
  command: PolicyCommand;
  /** the USING expression (row visibility), null if none. */
  usingExpr: string | null;
  /** the WITH CHECK expression (write validation), null if none. */
  withCheckExpr: string | null;
  /** roles the policy applies to, e.g. ["anon", "authenticated"]. */
  roles: string[];
}

export interface ColumnInfo {
  name: string;
  type: string;
}

export interface TableInfo {
  schema: string;
  name: string;
  columns: ColumnInfo[];
  rlsEnabled: boolean;
  policies: PolicyInfo[];
  /** views/materialized views are not base tables; PostgREST treats them differently. */
  isView?: boolean;
}

export interface SchemaSnapshot {
  tables: TableInfo[];
}

export type RlsIssue =
  | "rls_disabled"
  | "permissive_policy"
  | "owner_not_scoped"
  | "rls_no_policies";

export interface RlsFinding {
  fingerprint: string;
  issue: RlsIssue;
  severity: Severity;
  schema: string;
  table: string;
  title: string;
  /** plain-language explanation of what it is and what's at risk. */
  explanation: string;
  /** the ownership column we inferred, if any — drives fix generation. */
  ownershipColumn: string | null;
  /** true when a proposed CREATE POLICY migration can be generated. */
  fixable: boolean;
}

// Column names that conventionally denote row ownership by a user.
const OWNERSHIP_NAMES = [
  "user_id",
  "owner_id",
  "owner",
  "profile_id",
  "account_id",
  "created_by",
  "author_id",
  "uid",
];

// Postgres schemas exposed through the PostgREST API by default on Supabase.
const API_EXPOSED_SCHEMAS = new Set(["public"]);

function isApiExposed(t: TableInfo): boolean {
  return API_EXPOSED_SCHEMAS.has(t.schema) && !t.isView;
}

/** Infer the ownership column of a table, or null. Prefers uuid-typed matches. */
export function inferOwnershipColumn(t: TableInfo): string | null {
  const byName = t.columns.filter((c) =>
    OWNERSHIP_NAMES.includes(c.name.toLowerCase()),
  );
  if (byName.length === 0) return null;
  const uuid = byName.find((c) => c.type.toLowerCase().includes("uuid"));
  return (uuid ?? byName[0]!).name;
}

/** Is an expression effectively "always true" (permissive)? */
function isPermissive(expr: string | null): boolean {
  if (expr === null) return false;
  const norm = expr.replace(/\s+/g, "").replace(/[()]/g, "").toLowerCase();
  return norm === "true";
}

// Roles that BYPASS Row Level Security entirely. A permissive policy scoped only
// to these is NOT a vulnerability — it's the standard Supabase pattern (e.g.
// `service_role ALL USING (true)`). Only policies reachable by real API clients
// (anon / authenticated / public / custom roles) affect a user's access.
const RLS_BYPASS_ROLES = new Set([
  "service_role",
  "postgres",
  "supabase_admin",
  "supabase_auth_admin",
  "supabase_storage_admin",
  "dashboard_user",
  "authenticator",
]);

/** Does this policy apply to a role a real API client can use? */
function isClientFacing(p: PolicyInfo): boolean {
  if (p.roles.length === 0) return true; // no explicit role => PUBLIC (all roles)
  if (p.roles.includes("public")) return true;
  return p.roles.some((r) => !RLS_BYPASS_ROLES.has(r));
}

/** Does any policy expression tie rows to the current user via auth.uid()? */
function referencesAuthUid(policies: PolicyInfo[], ownershipCol: string | null): boolean {
  return policies.some((p) => {
    const blob = `${p.usingExpr ?? ""} ${p.withCheckExpr ?? ""}`.toLowerCase();
    const usesAuthUid = blob.includes("auth.uid()") || blob.includes("auth.jwt()");
    if (!usesAuthUid) return false;
    if (ownershipCol === null) return true;
    return blob.includes(ownershipCol.toLowerCase());
  });
}

function fp(issue: string, t: TableInfo): string {
  return fingerprint(["rls", issue, t.schema, t.name]);
}

/** Analyze a schema snapshot and return RLS findings, most severe first. */
export function analyzeRls(snapshot: SchemaSnapshot): RlsFinding[] {
  const findings: RlsFinding[] = [];

  for (const t of snapshot.tables) {
    if (!isApiExposed(t)) continue; // only API-reachable tables are at risk
    const ownershipColumn = inferOwnershipColumn(t);

    // A. RLS disabled on an API-exposed table.
    if (!t.rlsEnabled) {
      findings.push({
        fingerprint: fp("rls_disabled", t),
        issue: "rls_disabled",
        severity: "critical",
        schema: t.schema,
        table: t.name,
        title: `Row Level Security is off on "${t.name}"`,
        explanation:
          `The table "${t.schema}.${t.name}" is reachable through your project's ` +
          `API but Row Level Security is disabled. Anyone who has your public ` +
          `("anon") key — which ships in your app's frontend — can read and write ` +
          `every row, including other users' data.`,
        ownershipColumn,
        fixable: ownershipColumn !== null,
      });
      continue; // the disabled-RLS finding subsumes policy analysis
    }

    // RLS is enabled from here on. Only policies reachable by real API clients
    // matter — a permissive policy scoped to service_role (which bypasses RLS)
    // is expected and safe, so we ignore bypass-role policies throughout.
    const clientPolicies = t.policies.filter(isClientFacing);
    const permissive = clientPolicies.filter(
      (p) => isPermissive(p.usingExpr) || isPermissive(p.withCheckExpr),
    );

    // B. Permissive client-facing policy on a table with an ownership column.
    if (permissive.length > 0 && ownershipColumn !== null) {
      findings.push({
        fingerprint: fp("permissive_policy", t),
        issue: "permissive_policy",
        severity: "critical",
        schema: t.schema,
        table: t.name,
        title: `A policy on "${t.name}" allows access to every row`,
        explanation:
          `"${t.schema}.${t.name}" has a security policy that always evaluates to ` +
          `true (for example USING (true)). Even though the table looks protected, ` +
          `that policy lets any user read or modify rows that belong to other users. ` +
          `Since the table has a "${ownershipColumn}" column, access should be ` +
          `restricted to the row's owner.`,
        ownershipColumn,
        fixable: true,
      });
      continue;
    }

    // C. Ownership column present but no client policy scopes rows to auth.uid().
    if (
      ownershipColumn !== null &&
      clientPolicies.length > 0 &&
      !referencesAuthUid(clientPolicies, ownershipColumn)
    ) {
      findings.push({
        fingerprint: fp("owner_not_scoped", t),
        issue: "owner_not_scoped",
        severity: "high",
        schema: t.schema,
        table: t.name,
        title: `Rows in "${t.name}" may not be limited to their owner`,
        explanation:
          `"${t.schema}.${t.name}" has a "${ownershipColumn}" column that identifies ` +
          `the owner of each row, but none of its policies restrict access with ` +
          `auth.uid() = ${ownershipColumn}. Users may be able to see or change rows ` +
          `that belong to someone else.`,
        ownershipColumn,
        fixable: true,
      });
      continue;
    }

    // D. RLS enabled but no client-facing policies — fail closed, but often a
    // misconfig (any service_role-only policies don't grant app users access).
    if (clientPolicies.length === 0) {
      findings.push({
        fingerprint: fp("rls_no_policies", t),
        issue: "rls_no_policies",
        severity: "low",
        schema: t.schema,
        table: t.name,
        title: `"${t.name}" has RLS on but no policies for app users`,
        explanation:
          `"${t.schema}.${t.name}" has Row Level Security enabled but no policies ` +
          `that apply to your app's users (anon/authenticated), so the API currently ` +
          `denies them all access. This is safe, but often means the table was left ` +
          `half-configured — confirm this is intended.`,
        ownershipColumn,
        fixable: ownershipColumn !== null,
      });
    }
  }

  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}

/**
 * Generate a proposed migration that enables RLS and adds standard owner-scoped
 * policies for a table. Only valid when an ownership column was inferred.
 * We NEVER apply this automatically — it is proposed for the user to review.
 */
export function generateRlsMigration(
  table: Pick<TableInfo, "schema" | "name">,
  ownershipColumn: string,
): string {
  const q = `${ident(table.schema)}.${ident(table.name)}`;
  const p = (suffix: string) => ident(`${table.name}_${suffix}`);
  const owner = ident(ownershipColumn);
  return `-- Proposed by Kelp. Review before applying — do not run blindly.
-- Restricts every operation on ${table.schema}.${table.name} to the row's owner.

alter table ${q} enable row level security;

create policy ${p("select_own")} on ${q}
  for select using ((select auth.uid()) = ${owner});

create policy ${p("insert_own")} on ${q}
  for insert with check ((select auth.uid()) = ${owner});

create policy ${p("update_own")} on ${q}
  for update using ((select auth.uid()) = ${owner})
  with check ((select auth.uid()) = ${owner});

create policy ${p("delete_own")} on ${q}
  for delete using ((select auth.uid()) = ${owner});
`;
}

/** Minimal SQL identifier quoting (double-quote, escape embedded quotes). */
function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
