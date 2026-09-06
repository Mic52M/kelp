// BackendAdapter — the explicit seam every backend detection implements.
//
// Why this exists: Kelp today ships Supabase-only detection. The functions
// `parseRepoSchema`, `detectSupabaseConfig`, `discoverEdgeFunctions` and
// `buildAuthModelBrief` are *implicitly* Supabase-shaped — they presuppose a
// supabase/ folder, a PostgREST types.ts, a VITE_SUPABASE_URL, etc. To grow
// beyond Supabase without rewriting the whole scan pipeline each time, we
// freeze the operations every backend needs behind this interface and route
// the worker through a registry.
//
// NORTH-STAR: see #45. Tier 1 (build now) = Supabase (done) + Firebase (#38).
// Tier 2 (build when a paying customer asks) = Convex, Neon, PocketBase.
// Tier 3 (never) = Xano, Bubble, Airtable — no-code/low-code, wrong ICP.
//
// All four methods are MANDATORY. A partial implementation is a bug, not a
// feature — the registry rejects adapters missing any method at registration
// time, not at first scan. Better a loud crash on boot than a silent gap on
// the dashboard.

import type { SourceFile } from "../scanners/secrets.js";
import type { TableIntel } from "../agent/autonomous.js";
import type { DiscoveredEdgeFunction } from "../agent/edge-functions.js";
import type { AuthModelBrief } from "../agent/auth-model.js";

/**
 * Lightweight metadata a backend advertises about itself after a first pass
 * over the repo. Used to pick the right adapter and to render the
 * "what backend is this?" badge in the dashboard.
 */
export interface BackendMeta {
  /** Stable identifier, e.g. "supabase", "firebase", "convex". */
  type: string;
  /** Human-readable label for the UI, e.g. "Supabase". */
  label: string;
  /** Project-level config we managed to recover (URL, project ref, ...). */
  config: Record<string, unknown> | null;
}

/**
 * AuthModel is the structural type adapters return from `analyzeAuth`. The
 * canonical definition is AuthModelBrief; we re-export it under the more
 * neutral name because not every backend is going to care about the
 * cookie_session vs bearer_jwt distinction at the same granularity.
 */
export type AuthModel = AuthModelBrief;

/**
 * The four operations every backend adapter MUST implement:
 *
 *   1. `detectFromRepo`  — quick "is this repo this backend?" sniff.
 *                          Returns null when the repo doesn't match.
 *   2. `parseSchema`     — recover the table/column graph from repo source
 *                          (Supabase: supabase/migrations + types.ts).
 *   3. `discoverFunctions` — find the deployable surface (Supabase: edge
 *                            functions under supabase/functions/).
 *   4. `analyzeAuth`     — derive the static parts of the app's auth model
 *                          (cookie vs bearer, CORS posture, etc.).
 *
 * The 4-method shape was chosen because every static-recon backend needs
 * roughly these 4 capabilities. If a future backend needs a 5th, we add it
 * here and update all adapters — that's the point of the interface.
 */
export interface BackendAdapter {
  /** Stable identifier (e.g. "supabase"). Matches BackendMeta.type. */
  readonly type: string;

  /** Sniff: does this repo look like it uses this backend? */
  detectFromRepo(files: readonly SourceFile[]): BackendMeta | null;

  /** Recover the table/column graph from the repo's source. */
  parseSchema(files: readonly SourceFile[]): TableIntel[];

  /** Discover the deployable surface (edge functions, callable endpoints). */
  discoverFunctions(files: readonly SourceFile[]): DiscoveredEdgeFunction[];

  /** Static analysis of the app's auth model. */
  analyzeAuth(files: readonly SourceFile[]): AuthModel;
}

/** Reason a registration was rejected. Surfaced to the caller on error. */
export type AdapterRegistrationError =
  | { kind: "duplicate-type"; type: string }
  | { kind: "missing-method"; type: string; method: keyof BackendAdapter }
  | { kind: "wrong-arity"; type: string; method: keyof BackendAdapter; expected: number; got: number };

/**
 * A registry of BackendAdapters. The worker holds one of these and asks
 * "which backend is this?" once at the top of a scan, then uses the chosen
 * adapter for the rest of the pipeline.
 *
 * Implementation note: registration is strict on purpose. We use
 * `Function.prototype.length` to check arity, which catches:
 *   - a method missing entirely (arity mismatch)
 *   - a method bound to something with the wrong shape
 * We also verify the type is a non-empty string. Object-identity and
 * method-name sanity checks are deliberately kept light — the goal is to
 * catch typos and "I forgot to implement analyzeAuth" at boot, not to be
 * a full type system at runtime.
 */
export class BackendAdapterRegistry {
  private readonly adapters = new Map<string, BackendAdapter>();

  /** Register an adapter. Throws on duplicate, missing, or arity-violation. */
  register(adapter: BackendAdapter): BackendAdapter {
    if (typeof adapter.type !== "string" || adapter.type.length === 0) {
      throw new Error("BackendAdapter.type must be a non-empty string");
    }
    if (this.adapters.has(adapter.type)) {
      const err: AdapterRegistrationError = { kind: "duplicate-type", type: adapter.type };
      throw new Error(
        `BackendAdapterRegistry: duplicate adapter for type "${adapter.type}"`,
      );
    }
    const required: (keyof BackendAdapter)[] = [
      "detectFromRepo",
      "parseSchema",
      "discoverFunctions",
      "analyzeAuth",
    ];
    for (const method of required) {
      const fn = adapter[method] as unknown;
      if (typeof fn !== "function") {
        throw new Error(
          `BackendAdapterRegistry: adapter "${adapter.type}" is missing method "${method}"`,
        );
      }
      // arity for the 4 mandatory methods is 1 (files only)
      const arity = (fn as (...args: unknown[]) => unknown).length;
      // Each of the four mandatory methods takes ONE files argument. We allow
      // 1 or 2 because a future hook signature (e.g. (files, ctx)) might be
      // added without forcing every existing adapter to grow. We reject 0
      // (forgot the parameter) and 3+ (clearly wrong shape).
      if (arity < 1 || arity > 2) {
        throw new Error(
          `BackendAdapterRegistry: adapter "${adapter.type}" method "${method}" has arity ${arity}, expected at least 1`,
        );
      }
    }
    this.adapters.set(adapter.type, adapter);
    return adapter;
  }

  /** Get a specific adapter by type. Returns undefined when not registered. */
  get(type: string): BackendAdapter | undefined {
    return this.adapters.get(type);
  }

  /** List the registered adapter types, in registration order. */
  list(): string[] {
    return [...this.adapters.keys()];
  }

  /**
   * Find the first adapter that returns non-null from detectFromRepo. The
   * worker calls this once at the top of a scan to pick the backend.
   * Adapters run in registration order, so a more specific adapter
   * (e.g. one that checks a "firebase.json" sentinel file) should be
   * registered before a more general one.
   */
  detect(files: readonly SourceFile[]): BackendAdapter | null {
    for (const adapter of this.adapters.values()) {
      if (adapter.detectFromRepo(files) !== null) {
        return adapter;
      }
    }
    return null;
  }
}