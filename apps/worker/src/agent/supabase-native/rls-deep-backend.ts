// RLS-deep specialist backend, real customer variant (#27 follow-up, Stage A).
//
// The classic RLS analyzer (packages/core/src/scanners/rls.ts) reads
// pg_policies statically — it flags "no policy" and "USING(true)" without
// touching data. This backend is the active complement: authenticated as
// test account A, ask PostgREST directly for rows account A does NOT own and
// see whether any come back.
//
// Detection is designed for ZERO false positives across arbitrary customer
// schemas (owner columns aren't always auth uids — some apps store a username
// or an int). Two probes, both comparing against KNOWN uuids so a non-uuid
// owner column can never accidentally match:
//
//   1. As A, ask for a row owned by B:  ?<ownerCol>=eq.<B.uuid>&limit=1
//      A hit means A can read a row that belongs to account B → definitive
//      cross-account leak. (Needs B to actually own a row here.)
//
//   2. If A itself owns rows here (?<ownerCol>=eq.<A.uuid> returns a row —
//      which also proves the column holds auth uids), ask for rows NOT owned
//      by A: ?<ownerCol>=neq.<A.uuid>&limit=1. A hit means A can read other
//      users' rows even though the column is uuid-scoped → leak. This catches
//      broken RLS when B has no data here but some third user does.
//
// Either hit ⇒ cross-account read. Neither ⇒ RLS is scoping correctly (or we
// can't prove otherwise, in which case we deliberately stay silent rather than
// risk a false alarm). We only ever request a single row + count, never bodies.

import type { RlsDeepBackend } from "@kelp/core";
import type { DiscoveredTable } from "./schema.js";
import type { SupabaseSession } from "./auth.js";
import { postgrestGet } from "./postgrest.js";

export function createSupabaseRlsDeepBackend(cfg: {
  ref: string;
  anonKey: string;
  sessionA: SupabaseSession;
  /** Session B is needed as ground truth — we look for B's uuid in A's reads. */
  sessionB: SupabaseSession;
  tables: DiscoveredTable[];
}): RlsDeepBackend {
  const tablesByName = new Map(cfg.tables.map((t) => [t.name, t]));

  async function readsRowOwnedBy(table: string, ownerCol: string, ownerId: string): Promise<{ hit: boolean; status: number }> {
    const res = await postgrestGet({
      ref: cfg.ref,
      anonKey: cfg.anonKey,
      accessToken: cfg.sessionA.accessToken,
      table,
      options: { rawQuery: `${ownerCol}=eq.${encodeURIComponent(ownerId)}`, limit: 1 },
    }).catch(() => null);
    return { hit: !!res?.hasRows, status: res?.status ?? 0 };
  }

  return {
    async listTables() {
      // Only tables with an identifiable owner column can be probed — without
      // one there's no "whose row is this" question to ask, so we'd risk
      // flagging a legitimately-shared reference table (e.g. a list of sports).
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

      // 1. Can A read a row owned by B? (definitive, needs B to own data here)
      const bRow = await readsRowOwnedBy(table, ownerCol, cfg.sessionB.userId);
      if (bRow.status >= 400) return { crossAccountAccess: false };
      if (bRow.hit) return { crossAccountAccess: true };

      // 2. Does A own rows here (proves the column is uuid-scoped)? If so, are
      //    there rows A can read that A does NOT own?
      const aRow = await readsRowOwnedBy(table, ownerCol, cfg.sessionA.userId);
      if (!aRow.hit) return { crossAccountAccess: false };
      const notMine = await postgrestGet({
        ref: cfg.ref,
        anonKey: cfg.anonKey,
        accessToken: cfg.sessionA.accessToken,
        table,
        options: { rawQuery: `${ownerCol}=neq.${encodeURIComponent(cfg.sessionA.userId)}`, limit: 1 },
      }).catch(() => null);
      return { crossAccountAccess: !!notMine?.hasRows };
    },
  };
}
