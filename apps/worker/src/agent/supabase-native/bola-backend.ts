// BOLA specialist backend, real customer variant (#27 follow-up, Stage A).
//
// Cross-account probe over PostgREST. Two Supabase-Auth sessions (accounts A
// and B). At init, for each user-scoped table (one that has BOTH an id column
// AND an owner column — a public lookup table like "sports" has no owner and
// is correctly skipped):
//
//   1. As account B, fetch one row B genuinely owns (owner column == B) and
//      remember its id.
//
// At probe time, as account A, fetch that id back. If a row returns, A read a
// specific object owned by B across the trust boundary → BOLA confirmed.
//
// Requiring an owner column (and confirming B actually owns the sample row)
// eliminates the false positive where both accounts can read the same row of a
// legitimately-public reference table. The load-bearing invariant is unchanged:
// only ids (already known to B) and owner references are inspected; row bodies
// are never returned or logged.

import type { BolaProbeBackend } from "@kelp/core";
import type { DiscoveredTable } from "./schema.js";
import type { SupabaseSession } from "./auth.js";
import { postgrestGet } from "./postgrest.js";

/** ids we confirmed belong to account B, per table. */
type BOwnedIds = Map<string, string[]>;

async function collectBOwnedIds(cfg: {
  ref: string;
  anonKey: string;
  sessionB: SupabaseSession;
  tables: DiscoveredTable[];
}): Promise<BOwnedIds> {
  const out: BOwnedIds = new Map();
  await Promise.all(
    cfg.tables.map(async (t) => {
      if (!t.idColumn || t.ownerColumns.length === 0) return;
      const ownerCol = t.ownerColumns[0]!;
      // Ask specifically for a row B owns, so the id we probe with is genuinely
      // B's private object — not shared/reference data.
      const res = await postgrestGet({
        ref: cfg.ref,
        anonKey: cfg.anonKey,
        accessToken: cfg.sessionB.accessToken,
        table: t.name,
        options: {
          keepValuesFor: [t.idColumn],
          rawQuery: `${ownerCol}=eq.${encodeURIComponent(cfg.sessionB.userId)}`,
          limit: 1,
        },
      }).catch(() => null);
      if (!res || !res.hasRows) return;
      const id = res.ownerValues[t.idColumn];
      if (id !== null && id !== undefined) out.set(t.name, [id]);
    }),
  );
  return out;
}

export async function createSupabaseBolaBackend(cfg: {
  ref: string;
  anonKey: string;
  sessionA: SupabaseSession;
  sessionB: SupabaseSession;
  tables: DiscoveredTable[];
}): Promise<BolaProbeBackend> {
  const bOwned = await collectBOwnedIds(cfg);
  const tablesByName = new Map(cfg.tables.map((t) => [t.name, t]));

  return {
    async listEndpoints() {
      // Only user-scoped tables (id + owner column) where we actually found a
      // B-owned sample id — anything else can't produce a meaningful probe.
      const out: { endpoint: string; resourceKind: string; idParameter: string }[] = [];
      for (const t of cfg.tables) {
        if (!t.idColumn || t.ownerColumns.length === 0) continue;
        if (!bOwned.has(t.name)) continue;
        out.push({
          endpoint: `/rest/v1/${t.name}?${t.idColumn}=eq.{id}`,
          resourceKind: t.name,
          idParameter: t.idColumn,
        });
      }
      return out;
    },
    async probe(_projectId, endpoint) {
      const m = endpoint.match(/\/rest\/v1\/([^/?]+)/);
      const table = m?.[1];
      if (!table) return { crossAccountAccess: false };
      const t = tablesByName.get(table);
      const candidates = bOwned.get(table) ?? [];
      if (!t?.idColumn || t.ownerColumns.length === 0 || candidates.length === 0) {
        return { crossAccountAccess: false };
      }
      const ownerCol = t.ownerColumns[0]!;

      for (const id of candidates) {
        const encoded = encodeURIComponent(id);
        const res = await postgrestGet({
          ref: cfg.ref,
          anonKey: cfg.anonKey,
          accessToken: cfg.sessionA.accessToken,
          table,
          options: { rawQuery: `${t.idColumn}=eq.${encoded}`, keepValuesFor: [ownerCol], limit: 1 },
        }).catch(() => null);
        if (!res?.hasRows) continue;
        // A got B's object back. Confirm the row's owner is NOT A (it should be
        // B) — belt-and-braces against a table where id collides with A's own.
        const owner = res.ownerValues[ownerCol];
        if (owner !== cfg.sessionA.userId) return { crossAccountAccess: true };
      }
      return { crossAccountAccess: false };
    },
  };
}
