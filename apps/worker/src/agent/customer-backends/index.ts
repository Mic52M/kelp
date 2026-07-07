// Build the SpecialistEntry values for a real customer campaign (#27).
//
// Supabase-native. Kelp assumes the customer is on the vibe-coding stack
// (Lovable / Bolt / Cursor / v0 on Supabase). Two probe surfaces:
//
//   Stage A — PostgREST + Supabase Auth (always available):
//     ✓ BOLA        — cross-account row read by id
//     ✓ RLS-deep    — owner-column mismatch check
//     ✓ Exposure    — response field-name audit
//
//   Stage B — Supabase Edge Functions discovered from the connected repo
//     (`supabase/functions/*/index.ts`), only when a repo is connected:
//     ✓ Auth-bypass — does a function trust a client-supplied identity?
//     ✓ Injection   — payload vs baseline on text params
//     ✓ SSRF        — out-of-band callback on URL params
//     ✓ Weak-crypto — Set-Cookie flag audit
//
// SAFETY: the edge backends only ever invoke functions the discovery step
// classified NON-mutating — delete-account / create-payment-checkout / … are
// discovered, reported, and never called. When no repo (hence no edge
// functions) is connected, the four Stage-B specialists are simply omitted.

import {
  bolaSpecialist,
  exposureSpecialist,
  rlsDeepSpecialist,
  authBypassSpecialist,
  injectionSpecialist,
  ssrfSpecialist,
  weakCryptoSpecialist,
  type SpecialistEntry,
  type DiscoveredEdgeFunction,
} from "@kelp/core";
import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicDriver } from "../anthropic-driver.js";
import { loginSupabaseUser, resolveAnonKey, resolveServiceRoleKey } from "../supabase-native/auth.js";
import { listPublicTables } from "../supabase-native/schema.js";
import { createSupabaseBolaBackend } from "../supabase-native/bola-backend.js";
import { createSupabaseRlsDeepBackend } from "../supabase-native/rls-deep-backend.js";
import { createSupabaseExposureBackend } from "../supabase-native/exposure-backend.js";
import {
  createEdgeAuthBypassBackend,
  createEdgeInjectionBackend,
  createEdgeSsrfBackend,
  createEdgeWeakCryptoBackend,
} from "../supabase-native/edge-backends.js";

export interface CustomerCampaignConfig {
  /** Supabase project ref (short id, e.g. "hebrhezulnxlhgrfbegt"). */
  supabaseRef: string;
  /** Read-only Postgres connection string — feeds table discovery. */
  supabaseReadonlyConnString: string;
  /** Anon key path #1: explicit paste from Configuration. */
  supabaseAnonKey: string | null;
  /** Anon key path #2: fetched via Management PAT when path #1 is empty. */
  supabaseManagementPat: string | null;
  /** Callback so a discovered anon key can be cached back via putCredential —
   *  the next scan skips the Management-API round-trip. */
  onDiscoveredAnonKey?: (anonKey: string) => Promise<void>;
  /** Already-cached service-role key (from a previous auto-fetch). */
  supabaseServiceRoleKey?: string | null;
  /** Callback for caching a freshly-fetched service_role. */
  onDiscoveredServiceRoleKey?: (serviceRole: string) => Promise<void>;
  /** The two real Supabase-Auth users the campaign impersonates. */
  accountA: { email: string; password: string };
  accountB: { email: string; password: string };
  /** Edge functions discovered from the connected repo (Stage B). Empty/omitted
   *  when no repo is connected — the four HTTP specialists are then skipped. */
  edgeFunctions?: DiscoveredEdgeFunction[];
  /** Claude model — defaults to Haiku for cheap coverage. */
  model?: string;
  /** Anthropic API key; falls back to `ANTHROPIC_API_KEY` env. */
  anthropicApiKey?: string;
}

const DEFAULT_MODEL = "claude-haiku-4-5";

/**
 * Build the full 7-specialist campaign for a real customer project. Three
 * entries carry Supabase-native backends; four carry Stage-B-pending stubs
 * that immediately return "no endpoints yet" so the specialist finishes
 * cleanly and the campaign report notes what's coming.
 */
export async function buildCustomerCampaignEntries(
  cfg: CustomerCampaignConfig,
): Promise<SpecialistEntry<unknown, unknown>[]> {
  const model = cfg.model ?? DEFAULT_MODEL;
  const apiKey = cfg.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  // ── Resolve the anon key + (optional) service_role. Anon gates login;
  // ── service_role unlocks the admin-impersonation fallback when the
  // ── customer's stored password is wrong / stale / never worked.
  const anonKey = await resolveAnonKey({
    projectRef: cfg.supabaseRef,
    explicitAnonKey: cfg.supabaseAnonKey,
    managementPat: cfg.supabaseManagementPat,
    onDiscovered: cfg.onDiscoveredAnonKey,
  });
  const serviceRoleKey = await resolveServiceRoleKey({
    projectRef: cfg.supabaseRef,
    managementPat: cfg.supabaseManagementPat,
    cachedServiceRole: cfg.supabaseServiceRoleKey,
    onDiscovered: cfg.onDiscoveredServiceRoleKey,
  });
  const [sessionA, sessionB, tables] = await Promise.all([
    loginSupabaseUser({
      ref: cfg.supabaseRef,
      anonKey,
      email: cfg.accountA.email,
      password: cfg.accountA.password,
      serviceRoleKey,
    }),
    loginSupabaseUser({
      ref: cfg.supabaseRef,
      anonKey,
      email: cfg.accountB.email,
      password: cfg.accountB.password,
      serviceRoleKey,
    }),
    listPublicTables(cfg.supabaseReadonlyConnString),
  ]);
  if (sessionA.userId === sessionB.userId) {
    throw new Error(
      `Test accounts A and B resolved to the SAME Supabase user id — the ` +
        `cross-account probe would be meaningless. Use two distinct accounts.`,
    );
  }
  if (tables.length === 0) {
    throw new Error(
      "Kelp couldn't see any public tables via the read-only Postgres role. " +
        "Check that kelp_readonly has usage on schema public and that the " +
        "project actually has tables under the public schema.",
    );
  }

  const client = new Anthropic({ apiKey });
  const driver = () => createAnthropicDriver(client, model);

  const [bola, rlsDeep, exposure] = await Promise.all([
    createSupabaseBolaBackend({
      ref: cfg.supabaseRef,
      anonKey,
      sessionA,
      sessionB,
      tables,
    }),
    Promise.resolve(
      createSupabaseRlsDeepBackend({
        ref: cfg.supabaseRef,
        anonKey,
        sessionA,
        sessionB,
        tables,
      }),
    ),
    Promise.resolve(
      createSupabaseExposureBackend({
        ref: cfg.supabaseRef,
        anonKey,
        sessionA,
        tables,
      }),
    ),
  ]);

  const entries: SpecialistEntry<unknown, unknown>[] = [
    { specialist: bolaSpecialist as SpecialistEntry<unknown, unknown>["specialist"], backend: bola, driver: driver() },
    { specialist: exposureSpecialist as SpecialistEntry<unknown, unknown>["specialist"], backend: exposure, driver: driver() },
    { specialist: rlsDeepSpecialist as SpecialistEntry<unknown, unknown>["specialist"], backend: rlsDeep, driver: driver() },
  ];

  // Stage B: add the four Edge-Function specialists when a repo was connected
  // and at least one non-mutating function was discovered. The edge backends
  // themselves enforce the read-only-only safety rule.
  const edgeFunctions = cfg.edgeFunctions ?? [];
  const probeableEdge = edgeFunctions.filter((f) => !f.mutating);
  if (probeableEdge.length > 0) {
    const edgeCfg = { ref: cfg.supabaseRef, anonKey, sessionA, sessionB, functions: edgeFunctions };
    entries.push(
      { specialist: authBypassSpecialist as SpecialistEntry<unknown, unknown>["specialist"], backend: createEdgeAuthBypassBackend(edgeCfg), driver: driver() },
      { specialist: injectionSpecialist as SpecialistEntry<unknown, unknown>["specialist"], backend: createEdgeInjectionBackend(edgeCfg), driver: driver() },
      { specialist: ssrfSpecialist as SpecialistEntry<unknown, unknown>["specialist"], backend: createEdgeSsrfBackend(edgeCfg), driver: driver() },
      { specialist: weakCryptoSpecialist as SpecialistEntry<unknown, unknown>["specialist"], backend: createEdgeWeakCryptoBackend(edgeCfg), driver: driver() },
    );
  }

  return entries;
}
