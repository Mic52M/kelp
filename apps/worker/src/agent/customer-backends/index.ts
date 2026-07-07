// Build the seven SpecialistEntry values for a real customer campaign (#27).
//
// Stage A (this file's current shape) — Supabase-native. Kelp assumes the
// customer is on Supabase Auth + PostgREST (the vibe-coding stack: Lovable /
// Bolt / Cursor / v0 on Supabase). Three specialists probe real customer
// data through PostgREST with real signed-in JWTs; the other four are wired
// with "Stage B pending" no-op backends so the checklist stays honest about
// what's covered without crashing the campaign.
//
//   ✓ BOLA        — PostgREST cross-account row read (real)
//   ✓ RLS-deep    — PostgREST owner-column mismatch check (real)
//   ✓ Exposure    — PostgREST response field-name audit (real)
//   ⧗ Auth-bypass — needs HTTP endpoint discovery from the customer's repo
//   ⧗ Injection   — same
//   ⧗ SSRF        — same
//   ⧗ Weak-crypto — same (also needs a cookie-setting endpoint)
//
// Stage B (planned): walk the connected GitHub tarball to discover the real
// /api/* handlers (Next.js / Vercel functions / Express) and swap the four
// stubs in below for real backends.

import {
  bolaSpecialist,
  exposureSpecialist,
  rlsDeepSpecialist,
  type SpecialistEntry,
} from "@kelp/core";
import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicDriver } from "../anthropic-driver.js";
import { loginSupabaseUser, resolveAnonKey, resolveServiceRoleKey } from "../supabase-native/auth.js";
import { listPublicTables } from "../supabase-native/schema.js";
import { createSupabaseBolaBackend } from "../supabase-native/bola-backend.js";
import { createSupabaseRlsDeepBackend } from "../supabase-native/rls-deep-backend.js";
import { createSupabaseExposureBackend } from "../supabase-native/exposure-backend.js";

/** Names of specialists deliberately skipped at Stage A because they still
 *  need HTTP endpoint discovery from the customer's repo. The UI reads this
 *  to render "Stage B — coming" rows in the checklist / notes. */
export const STAGE_B_PENDING_SPECIALISTS = [
  "auth-bypass",
  "injection",
  "ssrf",
  "weak-crypto",
] as const;

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

  // Only ship the three specialists that have real customer backends today —
  // the four Stage-B-pending ones would otherwise waste Anthropic tokens for a
  // guaranteed zero-finding outcome. The ScanningView renders them explicitly
  // as "Stage B — coming" so the checklist stays honest.
  return [
    { specialist: bolaSpecialist as SpecialistEntry<unknown, unknown>["specialist"], backend: bola, driver: driver() },
    { specialist: exposureSpecialist as SpecialistEntry<unknown, unknown>["specialist"], backend: exposure, driver: driver() },
    { specialist: rlsDeepSpecialist as SpecialistEntry<unknown, unknown>["specialist"], backend: rlsDeep, driver: driver() },
  ];
}
