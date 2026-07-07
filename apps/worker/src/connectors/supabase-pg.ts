// Supabase connector — direct-Postgres variant (issue #5).
//
// The Management API PAT this project used until now is account-level: it can
// pause the project, rotate keys, add branches. Kelp only needs to READ the
// schema and RLS state. This connector instead speaks to a per-project
// read-only Postgres role (`kelp_readonly`) that the customer creates by
// running the SQL snippet in docs/supabase-readonly-role.sql.
//
// The connection strategy (post-item-#1): the customer pastes the STANDARD
// Session-pooler URL from Supabase ("postgres.<ref>:<pass>@aws-0-<region>
// .pooler.supabase.com:5432/postgres") — no manual rewrites. We connect as
// `postgres` (which Supavisor always knows how to route) and then issue
// SET ROLE kelp_readonly at session start. That gives us least-privilege
// reads without depending on Supavisor knowing custom role names, which is
// unreliable on newer projects (ENOTFOUND tenant/user … not found).
//
// Behaviour parity: produces the same SchemaSnapshot shape as the Management-
// API connector (same three SQL queries), so analyzeRls() can't tell them
// apart. That's the point — we don't want the analysis to change when we
// tighten credentials.
//
// Lifecycle: a Postgres Client is created per snapshot call and closed after,
// because scans are infrequent and we don't want per-project pools sitting
// idle. If this ever gets hot, swap to a small keyed pool cache.

import pg from "pg";
import type {
  ColumnInfo,
  PolicyCommand,
  PolicyInfo,
  SchemaSnapshot,
  SupabaseConnector,
  TableInfo,
} from "@kelp/core";

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

const VALID_CMDS: PolicyCommand[] = ["SELECT", "INSERT", "UPDATE", "DELETE", "ALL"];

/** The role we install via the setup SQL — used by connectAsReadonly() below. */
export const KELP_READONLY_ROLE = "kelp_readonly";

/**
 * Open a pg.Client on the supplied connection string and switch to the
 * least-privilege role. Callers must .end() the client — this helper only
 * bundles connect + SET ROLE so both the connector and the validator share
 * the exact same behaviour. Throws with a user-facing message when SET ROLE
 * fails (usually: the customer forgot to run the setup SQL).
 */
export async function connectAsReadonly(connectionString: string): Promise<pg.Client> {
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(`set role ${KELP_READONLY_ROLE}`);
  } catch (e) {
    await client.end().catch(() => {});
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Kelp connected but couldn't switch to the "${KELP_READONLY_ROLE}" role: ` +
        `${msg.slice(0, 160)}. Run the setup SQL (Settings → How do I get this?) ` +
        `and try again.`,
    );
  }
  return client;
}

function normalizeCmd(cmd: string | null): PolicyCommand {
  const up = (cmd ?? "ALL").toUpperCase();
  return (VALID_CMDS as string[]).includes(up) ? (up as PolicyCommand) : "ALL";
}

/**
 * Build the Postgres-direct Supabase connector. `connectionString` is the
 * `postgres://kelp_readonly:…@…` URL the customer supplied (encrypted at rest
 * as credential kind `supabase_readonly_connstring`). We enable TLS with
 * rejectUnauthorized=false to match the rest of the worker's connections —
 * Supabase serves valid certs, but their intermediate isn't in the default CA
 * bundle in every runtime.
 */
export function createSupabasePgConnector(cfg: { connectionString: string }): SupabaseConnector {
  async function withClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
    const client = await connectAsReadonly(cfg.connectionString);
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }

  return {
    // `projectRef` is intentionally unused in this variant — the connection
    // string IS the specific project. The interface receives it so the two
    // connectors are drop-in swappable at the scan-processor layer.
    async getSchemaSnapshot(_projectRef: string): Promise<SchemaSnapshot> {
      return withClient(async (client) => {
        const [tableRes, columnRes, policyRes] = await Promise.all([
          client.query(TABLES_SQL),
          client.query(COLUMNS_SQL),
          client.query(POLICIES_SQL),
        ]);

        const colsByTable = new Map<string, ColumnInfo[]>();
        for (const c of columnRes.rows as { table_name: string; column_name: string; data_type: string }[]) {
          const list = colsByTable.get(c.table_name) ?? [];
          list.push({ name: c.column_name, type: c.data_type });
          colsByTable.set(c.table_name, list);
        }

        const polsByTable = new Map<string, PolicyInfo[]>();
        for (const p of policyRes.rows as {
          tablename: string;
          policyname: string;
          cmd: string | null;
          qual: string | null;
          with_check: string | null;
          roles: string[] | null;
        }[]) {
          const list = polsByTable.get(p.tablename) ?? [];
          list.push({
            name: p.policyname,
            command: normalizeCmd(p.cmd),
            usingExpr: p.qual,
            withCheckExpr: p.with_check,
            // pg driver returns text[] as JS array natively — no parsing needed.
            roles: p.roles ?? [],
          });
          polsByTable.set(p.tablename, list);
        }

        const tables: TableInfo[] = (
          tableRes.rows as { schema: string; name: string; relkind: string; rls_enabled: boolean }[]
        ).map((t) => ({
          schema: t.schema,
          name: t.name,
          columns: colsByTable.get(t.name) ?? [],
          rlsEnabled: t.rls_enabled,
          isView: t.relkind === "v" || t.relkind === "m",
          policies: polsByTable.get(t.name) ?? [],
        }));

        return { tables };
      });
    },
  };
}
