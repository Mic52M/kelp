// Shared repo-recon entry point the worker calls once per scan.
//
// Why this helper exists: the worker needs four things from the registry —
// which backend, its meta, the edge-function list, the schema, and the
// worker-local repoConfig — and two review bugs lived in the inline version
// of this logic in `scan-processor.ts`:
//
//   1. Shape mismatch: the adapter returns `{ config: { url, ref, anonKey,
//      hasAnonKey } }` but the call site cast to `{ ref, url, anonKey }`
//      and read the fields off the top level, yielding all-undefined.
//      Fixed here by reading from `backendMeta.config` with the
//      discriminated union (`meta.type === "supabase"` narrows `config`
//      to `SupabaseBackendConfig`), no casts.
//   2. Silent recon regression: gating `discoverFunctions`/`parseSchema`
//      on `detectFromRepo() !== null` (i.e. "found VITE_SUPABASE_URL in an
//      env file") drops recon for repos with `supabase/functions/` or
//      `supabase/migrations/` but no committed env file — exactly the
//      Bolt/Lovable/Replit shape. Fixed here by falling back to the
//      Supabase adapter for those two calls when no backend is detected,
//      restoring master's unconditional behavior. When a second adapter
//      lands, revisit: either union recon across adapters or gate on
//      per-adapter surface sentinels.
//
// Pure and unit-tested in `recon.test.ts` — including the exact assertions
// the reviewer asked for (`repoConfig.url === "…"` on an env-file repo,
// non-empty schema/functions on an env-less Supabase-surface repo).

import type { SourceFile } from "../scanners/secrets.js";
import type { TableIntel } from "../agent/autonomous.js";
import type { DiscoveredEdgeFunction } from "../agent/edge-functions.js";
import type {
  BackendAdapter,
  BackendMeta,
} from "./backend-adapter.js";
import { isSupabaseBackendMeta } from "./backend-adapter.js";
import type { BackendAdapterRegistry } from "./backend-adapter.js";
import { defaultBackendRegistry } from "./registry.js";
import { SUPABASE_TYPE } from "./supabase.js";

/** Worker-local Supabase shape downstream code consumes (url, ref, key). */
export interface RepoSupabaseConfig {
  url: string;
  ref: string;
  anonKey: string | null;
}

export interface RepoReconResult {
  /** Adapter that claimed the repo, null when none did. */
  backend: BackendAdapter | null;
  /** Meta from `detectFromRepo`, null when no adapter claimed the repo. */
  backendMeta: BackendMeta | null;
  /** Deployable surface (edge functions / callables). Never gated on env. */
  edgeFunctions: DiscoveredEdgeFunction[];
  /** Table/column graph. Never gated on env. */
  repoSchema: TableIntel[];
  /** Worker-local (url, ref, anonKey). Only set for Supabase today. */
  repoConfig: RepoSupabaseConfig | null;
}

/**
 * Run repo recon through the registry. `parseSchema`/`discoverFunctions`
 * fall back to the registered Supabase adapter when detection returns null
 * so env-less repos keep their recon (see header).
 */
export function reconRepoViaRegistry(
  files: readonly SourceFile[],
  registry: BackendAdapterRegistry = defaultBackendRegistry,
): RepoReconResult {
  const backend = registry.detect(files);
  const backendMeta = backend?.detectFromRepo(files) ?? null;

  // Blocking #2: never gate these on env-file detection. With only
  // Supabase registered, `backend ?? supabase` is exactly master's
  // "always run Supabase recon". The adapter methods themselves return []
  // when their surface is absent, so this is safe on non-Supabase repos.
  const reconAdapter =
    backend ?? registry.get(SUPABASE_TYPE) ?? null;
  const edgeFunctions: DiscoveredEdgeFunction[] = reconAdapter
    ? reconAdapter.discoverFunctions(files)
    : [];
  const repoSchema: TableIntel[] = reconAdapter
    ? reconAdapter.parseSchema(files)
    : [];

  // Blocking #1: read from `backendMeta.config` via the type guard — no
  // casts. `hasAnonKey` stays a UI hint; the value flows through `anonKey`.
  let repoConfig: RepoSupabaseConfig | null = null;
  if (
    backend?.type === SUPABASE_TYPE &&
    backendMeta !== null &&
    isSupabaseBackendMeta(backendMeta)
  ) {
    repoConfig = {
      url: backendMeta.config.url,
      ref: backendMeta.config.ref,
      anonKey: backendMeta.config.anonKey,
    };
  }

  return { backend, backendMeta, edgeFunctions, repoSchema, repoConfig };
}
