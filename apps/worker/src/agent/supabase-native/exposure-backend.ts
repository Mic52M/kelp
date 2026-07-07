// Exposure specialist backend, real customer variant (#27 follow-up, Stage A).
//
// Field-name audit: as account A, GET one row from each public table via
// PostgREST and return only the top-level field NAMES back to the specialist.
// Kelp — never the LLM — decides which of those names look like leaking
// secrets (see packages/core/src/agent/specialists/exposure.ts and its
// SENSITIVE_TERMS dictionary). Values are never captured or logged.

import type { ExposureBackend } from "@kelp/core";
import type { DiscoveredTable } from "./schema.js";
import type { SupabaseSession } from "./auth.js";
import { postgrestGet } from "./postgrest.js";

export function createSupabaseExposureBackend(cfg: {
  ref: string;
  anonKey: string;
  sessionA: SupabaseSession;
  tables: DiscoveredTable[];
}): ExposureBackend {
  return {
    async listEndpoints() {
      // Every public table PostgREST exposes is an "endpoint" from the
      // specialist's POV — the response body is what we audit for shape.
      return cfg.tables.map((t) => ({
        endpoint: `/rest/v1/${t.name}`,
        description: `Supabase PostgREST table "${t.name}"`,
      }));
    },
    async probeResponseShape(_projectId, endpoint) {
      // The specialist calls back with the exact string it got from
      // listEndpoints, so we parse the table back out of it.
      const m = endpoint.match(/\/rest\/v1\/([^/?]+)/);
      const table = m?.[1];
      if (!table) return { fieldNames: [] };
      const res = await postgrestGet({
        ref: cfg.ref,
        anonKey: cfg.anonKey,
        accessToken: cfg.sessionA.accessToken,
        table,
      });
      return { fieldNames: res.firstRowFields };
    },
  };
}
