// BOLA specialist backend, real customer variant (#27 follow-up, Stage A).
//
// Cross-account probe over PostgREST. Two Supabase-Auth sessions (accounts A
// and B). At init:
//
//   1. Discover which public tables PostgREST exposes + their id column.
//   2. As account B, GET a couple of ids per table (limit=2). These are our
//      "B-owned resource ids" — the exact same slot the test-target backend
//      passed in as `bOwnedIds`.
//
// At probe time, as account A, replay each candidate id — if any row comes
// back, A can read B's rows across the trust boundary → BOLA confirmed.
//
// The load-bearing invariant is unchanged: only ids (already known to B)
// are copied; A's / B's row bodies are never returned or logged.

import type { BolaProbeBackend } from "@kelp/core";
import type { DiscoveredTable } from "./schema.js";
import type { SupabaseSession } from "./auth.js";
import { postgrestGet } from "./postgrest.js";

/** ids we already know belong to account B, per table. Populated once at
 *  backend construction so probes don't do extra round-trips. */
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
      if (!t.idColumn) return;
      const res = await postgrestGet({
        ref: cfg.ref,
        anonKey: cfg.anonKey,
        accessToken: cfg.sessionB.accessToken,
        table: t.name,
        options: { keepValuesFor: [t.idColumn] },
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
      // Only tables we found (a) an id column for and (b) at least one B-owned
      // id in — probing anything else can't distinguish "no policy" from
      // "genuinely nothing there".
      const out: { endpoint: string; resourceKind: string; idParameter: string }[] = [];
      for (const t of cfg.tables) {
        if (!t.idColumn) continue;
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
      if (!t?.idColumn || candidates.length === 0) return { crossAccountAccess: false };

      for (const id of candidates) {
        const encoded = encodeURIComponent(id);
        const res = await postgrestGet({
          ref: cfg.ref,
          anonKey: cfg.anonKey,
          accessToken: cfg.sessionA.accessToken,
          table,
          options: { rawQuery: `${t.idColumn}=eq.${encoded}` },
        }).catch(() => null);
        if (res?.hasRows) return { crossAccountAccess: true };
      }
      return { crossAccountAccess: false };
    },
  };
}
