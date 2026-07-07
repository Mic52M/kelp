// List the tables a real Supabase project exposes over PostgREST, reusing the
// same read-only Postgres connection Kelp already opens for the RLS analyzer.
// Public schema only — PostgREST doesn't expose other schemas by default, and
// we don't want the pen test poking around auth.* / storage.*.

import { connectAsReadonly } from "../../connectors/supabase-pg.js";

/** One customer-visible table, as far as the pen test can tell. */
export interface DiscoveredTable {
  /** unquoted public-schema table name — e.g. "orders" */
  name: string;
  /** columns Kelp can identify as an owner column (user_id, owner_id, …). Used
   *  by the BOLA / RLS-deep backends to check whether a row belongs to A or B. */
  ownerColumns: string[];
  /** best-guess primary-key column (usually "id"). Used when synthesizing
   *  BOLA probe URLs. Null when we can't identify one. */
  idColumn: string | null;
}

/** Column names Kelp treats as owner-of-row candidates. Order matters — first
 *  match wins when we pick "the" owner column for a probe. */
const OWNER_COLUMN_HINTS = [
  "user_id",
  "owner_id",
  "created_by",
  "author_id",
  "profile_id",
  "account_id",
];

/**
 * List every table PostgREST exposes for this project, and for each the
 * columns that look like row-owner references. Runs one Postgres session
 * (SET ROLE kelp_readonly) so it inherits the same least-privilege posture as
 * the passive RLS analyzer.
 */
export async function listPublicTables(connString: string): Promise<DiscoveredTable[]> {
  const client = await connectAsReadonly(connString);
  try {
    const { rows: tableRows } = await client.query<{ name: string }>(
      `select c.relname as name
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p')
        order by c.relname`,
    );
    if (tableRows.length === 0) return [];

    const { rows: colRows } = await client.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name
         from information_schema.columns
        where table_schema = 'public'`,
    );
    const colsByTable = new Map<string, string[]>();
    for (const c of colRows) {
      const list = colsByTable.get(c.table_name) ?? [];
      list.push(c.column_name);
      colsByTable.set(c.table_name, list);
    }

    return tableRows.map((t) => {
      const cols = colsByTable.get(t.name) ?? [];
      const ownerColumns = cols.filter((c) => OWNER_COLUMN_HINTS.includes(c));
      const idColumn = cols.includes("id") ? "id" : null;
      return { name: t.name, ownerColumns, idColumn };
    });
  } finally {
    await client.end().catch(() => {});
  }
}
