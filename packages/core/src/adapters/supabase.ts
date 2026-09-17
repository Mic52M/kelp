// SupabaseBackendAdapter — the first BackendAdapter implementation.
//
// All four methods are thin wrappers over the existing functions in
// `agent/repo-recon.ts`, `agent/edge-functions.ts` and `agent/auth-model.ts`.
// No behavior change — the worker used to call those functions directly;
// now it goes through this adapter. The interface is the seam; the
// implementation is the same code as before.
//
// Why wrappers instead of moving the logic:
//   - Keeps the diff to this PR minimal.
//   - Keeps the unit tests for the underlying functions valid without
//     rewriting them. (Moving the code would force moving the tests too.)
//   - Future adapters (Firebase in #38) get a clear pattern to copy.

import type { BackendAdapter, SupabaseBackendMeta, AuthModel } from "./backend-adapter.js";
import type { SourceFile } from "../scanners/secrets.js";
import type { TableIntel } from "../agent/autonomous.js";
import type { DiscoveredEdgeFunction } from "../agent/edge-functions.js";
import { detectSupabaseConfig, parseRepoSchema } from "../agent/repo-recon.js";
import { discoverEdgeFunctions } from "../agent/edge-functions.js";
import { buildAuthModelBrief } from "../agent/auth-model.js";

export const SUPABASE_TYPE = "supabase" as const;

/**
 * The Supabase BackendAdapter. One per process; the registry holds a single
 * instance. `analyzeAuth` for Supabase falls back to the generic static
 * auth-model builder — the model is backend-agnostic by design (cookie
 * session vs bearer JWT is the same concept on every backend), so the
 * Supabase adapter does not need a Supabase-specific implementation here.
 */
export const supabaseAdapter: BackendAdapter = {
  type: SUPABASE_TYPE,

  detectFromRepo(files: readonly SourceFile[]): SupabaseBackendMeta | null {
    const cfg = detectSupabaseConfig(files);
    if (!cfg) return null;
    return {
      type: SUPABASE_TYPE,
      label: "Supabase",
      config: {
        url: cfg.url,
        ref: cfg.ref,
        // The worker needs the actual key value for recon (resolveAnonKey
        // fallback + persist-as-detected). `hasAnonKey` is a UI hint only —
        // never a substitute for the value. Previously this dropped the
        // value and the worker read `repoConfig.anonKey` as undefined
        // (review #45 blocking #1).
        anonKey: cfg.anonKey,
        hasAnonKey: cfg.anonKey !== null,
      },
    };
  },

  parseSchema(files: readonly SourceFile[]): TableIntel[] {
    return parseRepoSchema(files);
  },

  discoverFunctions(files: readonly SourceFile[]): DiscoveredEdgeFunction[] {
    return discoverEdgeFunctions(files);
  },

  analyzeAuth(files: readonly SourceFile[]): AuthModel {
    return buildAuthModelBrief(files);
  },
};
