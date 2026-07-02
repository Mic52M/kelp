// Real Supabase connector. Reads the project's schema, RLS state, columns and
// policies through the Management API's SQL query endpoint (read-only queries
// against the catalog), and assembles the SchemaSnapshot the RLS analyzer needs.
//
// NOTE (see issue #5): the Management API PAT is account-level. For production we
// will switch to a per-project read-only Postgres role. This connector isolates
// that concern — analyzeRls() only sees the SchemaSnapshot, not how we got it.

import type {
  SupabaseConnector,
  SchemaSnapshot,
  TableInfo,
  PolicyInfo,
  PolicyCommand,
  ColumnInfo,
} from "@kelp/core";

const API = "https://api.supabase.com/v1";

const TABLES_SQL = `
  select n.nspname as schema, c.relname as name, c.relkind as relkind,
         c.relrowsecurity as rls_enabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','v','m','p')
  order by c.relname;`;

const COLUMNS_SQL = `
  select table_name, column_name, data_type
  from information_schema.columns
  where table_schema = 'public';`;

const POLICIES_SQL = `
  select tablename, policyname, cmd, qual, with_check, roles
  from pg_policies
  where schemaname = 'public';`;

interface TableRow { schema: string; name: string; relkind: string; rls_enabled: boolean }
interface ColumnRow { table_name: string; column_name: string; data_type: string }
interface PolicyRow {
  tablename: string;
  policyname: string;
  cmd: string | null;
  qual: string | null;
  with_check: string | null;
  roles: string[] | string | null;
}

const VALID_CMDS: PolicyCommand[] = ["SELECT", "INSERT", "UPDATE", "DELETE", "ALL"];

function normalizeCmd(cmd: string | null): PolicyCommand {
  const up = (cmd ?? "ALL").toUpperCase();
  return (VALID_CMDS as string[]).includes(up) ? (up as PolicyCommand) : "ALL";
}

/** pg roles come back either as a JS array or a Postgres array literal "{a,b}". */
function parseRoles(roles: string[] | string | null): string[] {
  if (Array.isArray(roles)) return roles;
  if (typeof roles === "string" && roles.startsWith("{")) {
    return roles.slice(1, -1).split(",").map((r) => r.replace(/^"|"$/g, "")).filter(Boolean);
  }
  return [];
}

export function createSupabaseConnector(cfg: { managementToken: string }): SupabaseConnector {
  async function runQuery<T>(ref: string, sql: string): Promise<T[]> {
    const res = await fetch(`${API}/projects/${ref}/database/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.managementToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Supabase Management API ${res.status}: ${body.slice(0, 300)}`);
    }
    return (await res.json()) as T[];
  }

  return {
    async getSchemaSnapshot(projectRef: string): Promise<SchemaSnapshot> {
      const [tableRows, columnRows, policyRows] = await Promise.all([
        runQuery<TableRow>(projectRef, TABLES_SQL),
        runQuery<ColumnRow>(projectRef, COLUMNS_SQL),
        runQuery<PolicyRow>(projectRef, POLICIES_SQL),
      ]);

      const colsByTable = new Map<string, ColumnInfo[]>();
      for (const c of columnRows) {
        const list = colsByTable.get(c.table_name) ?? [];
        list.push({ name: c.column_name, type: c.data_type });
        colsByTable.set(c.table_name, list);
      }

      const polsByTable = new Map<string, PolicyInfo[]>();
      for (const p of policyRows) {
        const list = polsByTable.get(p.tablename) ?? [];
        list.push({
          name: p.policyname,
          command: normalizeCmd(p.cmd),
          usingExpr: p.qual,
          withCheckExpr: p.with_check,
          roles: parseRoles(p.roles),
        });
        polsByTable.set(p.tablename, list);
      }

      const tables: TableInfo[] = tableRows.map((t) => ({
        schema: t.schema,
        name: t.name,
        columns: colsByTable.get(t.name) ?? [],
        rlsEnabled: t.rls_enabled,
        isView: t.relkind === "v" || t.relkind === "m",
        policies: polsByTable.get(t.name) ?? [],
      }));

      return { tables };
    },
  };
}
