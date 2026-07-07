// RLS-deep specialist backend, real customer variant (#27 follow-up, Stage A).
//
// The classic RLS analyzer (packages/core/src/scanners/rls.ts) reads
// pg_policies statically — it flags "no policy" and "USING(true)" without
// touching data. This backend is the active complement: authenticated as
// test account A, hit PostgREST `/rest/v1/<table>?limit=3&<own-filter>=…`
// and check whether the response includes rows owned by anyone OTHER than A.
//
// The load-bearing invariant: no row data ever enters the transcript. We copy
// only the owner-column value from the first row (via postgrestGet's
// `keepValuesFor`) so the executor can decide "was this A's row or someone
// else's" — the full row body is never read.
//
// Coverage matches the static analyzer's finding classes:
//   - table has NO owner-column candidate  → we can't tell A from B, skip
//   - table has RLS off / permissive       → A sees rows with other owners →
//                                            crossAccountAccess = true
//   - table has proper RLS                 → A sees only its own rows →
//                                            crossAccountAccess = false

import type { RlsDeepBackend } from "@kelp/core";
import type { DiscoveredTable } from "./schema.js";
import type { SupabaseSession } from "./auth.js";
import { postgrestGet } from "./postgrest.js";

export function createSupabaseRlsDeepBackend(cfg: {
  ref: string;
  anonKey: string;
  sessionA: SupabaseSession;
  tables: DiscoveredTable[];
}): RlsDeepBackend {
  const tablesByName = new Map(cfg.tables.map((t) => [t.name, t]));
  return {
    async listTables() {
      // Only tables with an identifiable owner column can be probed — without
      // one there's no way to tell "A's row" from "B's row" post-fetch, so
      // we'd risk false positives.
      return cfg.tables
        .filter((t) => t.ownerColumns.length > 0)
        .map((t) => ({
          table: t.name,
          description: `owner column: ${t.ownerColumns.join(", ")}`,
        }));
    },
    async probeCrossAccountRead(_projectId, table) {
      const t = tablesByName.get(table);
      if (!t || t.ownerColumns.length === 0) return { crossAccountAccess: false };
      const ownerCol = t.ownerColumns[0]!;
      const res = await postgrestGet({
        ref: cfg.ref,
        anonKey: cfg.anonKey,
        accessToken: cfg.sessionA.accessToken,
        table,
        options: { keepValuesFor: [ownerCol] },
      });
      if (!res.hasRows) return { crossAccountAccess: false };
      const observedOwner = res.ownerValues[ownerCol];
      // If PostgREST returned a row whose owner column is NOT account A, RLS
      // isn't scoping reads by user — that's the cross-account leak.
      if (observedOwner !== null && observedOwner !== cfg.sessionA.userId) {
        return { crossAccountAccess: true };
      }
      return { crossAccountAccess: false };
    },
  };
}
