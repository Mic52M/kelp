// Build the seven SpecialistEntry values for a real customer campaign (#27).
//
// MVP scope (issue #27, first pass): each backend re-uses the existing
// test-target-*-backend.ts factory, which already accepts a `baseUrl` +
// two test-account credentials. That means a customer whose deployed app
// happens to follow the shape of our in-repo test target (POST /api/login,
// GET /api/orders/:id, ...) will get real findings today; a customer whose
// endpoints look different will get zero findings (the specialist crashes
// on login and its outcome carries `error`, but the campaign continues).
//
// Endpoint discovery from the connected repo + Supabase schema is the
// planned follow-up — see the "What's next" section in AGENT-FRAMEWORK.md.

import {
  authBypassSpecialist,
  bolaSpecialist,
  exposureSpecialist,
  injectionSpecialist,
  rlsDeepSpecialist,
  ssrfSpecialist,
  weakCryptoSpecialist,
  type SpecialistEntry,
} from "@kelp/core";
import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicDriver } from "../anthropic-driver.js";
import { createTestTargetBolaBackend } from "../test-target-backend.js";
import { createTestTargetAuthBypassBackend } from "../test-target-auth-bypass-backend.js";
import { createTestTargetInjectionBackend } from "../test-target-injection-backend.js";
import { createTestTargetSsrfBackend } from "../test-target-ssrf-backend.js";
import { createTestTargetExposureBackend } from "../test-target-exposure-backend.js";
import { createTestTargetRlsDeepBackend } from "../test-target-rls-deep-backend.js";
import { createTestTargetWeakCryptoBackend } from "../test-target-weak-crypto-backend.js";

export interface CustomerCampaignConfig {
  appBaseUrl: string;
  accountA: { email: string; password: string };
  accountB: { email: string; password: string };
  /**
   * The target-user identity account A tries to reach cross-account. For BOLA
   * and RLS-deep we use `targetOwnedIds` (resource ids owned by B) and
   * `targetOwnerId` (B's user id). MVP ships the test-target seeds; the real
   * customer flow will discover them per project.
   */
  targetOwnerId?: string;
  targetOwnedIds?: string[];
  /** Claude model — defaults to Haiku for cheap coverage. */
  model?: string;
  /** Anthropic API key; falls back to `ANTHROPIC_API_KEY` env. */
  anthropicApiKey?: string;
}

const DEFAULT_MODEL = "claude-haiku-4-5";
const DEFAULT_TARGET_OWNER_ID = "userB";
const DEFAULT_TARGET_OWNED_IDS = ["ord_2001", "ord_2002"];

/** Wall-clock cap for the preflight probe. Real /api/login should answer in
 *  well under a second; a stalled SPA proxy would otherwise hang the campaign. */
const PREFLIGHT_TIMEOUT_MS = 8000;

/**
 * Check that the target app looks like the shape the MVP customer backends
 * understand (POST /api/login → JSON {token}). Throws a user-facing error
 * that ends up in scans.error → the dashboard scan-issues banner when the
 * target doesn't fit — the seven specialists share this same auth shape, so
 * one preflight covers all of them.
 */
async function assertTargetMatchesTestShape(
  baseUrl: string,
  accountA: { email: string; password: string },
): Promise<void> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/login`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: accountA.email, password: accountA.password }),
      signal: AbortSignal.timeout(PREFLIGHT_TIMEOUT_MS),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Kelp couldn't reach POST ${url} within ${PREFLIGHT_TIMEOUT_MS / 1000}s (${msg}). ` +
        `The active pen test's MVP customer path targets an /api/login endpoint that ` +
        `returns JSON {token}. Real endpoint discovery from your repo is on the roadmap ` +
        `(#27 follow-up) — until then, the campaign only works on apps that match this shape.`,
    );
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      `${url} answered ${res.status} with "${contentType || "unknown"}" instead of JSON. ` +
        `Most Lovable / Vercel SPAs catch unknown paths with index.html — the active pen ` +
        `test's MVP customer path needs a real POST /api/login endpoint that returns ` +
        `JSON {token}. Real endpoint discovery from your repo is the planned follow-up (#27); ` +
        `until it ships, active pen tests can only run against apps with this exact shape.`,
    );
  }

  if (!res.ok) {
    throw new Error(
      `POST ${url} rejected the test account with HTTP ${res.status}. ` +
        `Double-check the Test account A credentials on the Configuration page, or that ` +
        `Kelp's IP isn't blocked by your app's auth layer.`,
    );
  }

  // Consume the body so the connection is released; no need to keep it — the
  // seven backends will re-login themselves during their factory phase.
  await res.text();
}

/**
 * Build the full 7-specialist campaign for a customer project. Each entry
 * gets its own Anthropic driver instance — the orchestrator's per-specialist
 * usage accounting relies on that isolation.
 */
export async function buildCustomerCampaignEntries(
  cfg: CustomerCampaignConfig,
): Promise<SpecialistEntry<unknown, unknown>[]> {
  const model = cfg.model ?? DEFAULT_MODEL;
  const apiKey = cfg.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  // MVP compatibility preflight (issue #27 follow-up). The seven customer
  // backends currently reuse the test-target endpoint shape (POST /api/login
  // returning JSON {token}, then /api/orders/{id}, /api/profiles/{id} etc.).
  // A real Lovable / Vercel SPA usually catches every unknown path with
  // index.html + HTTP 200 — so the naive `res.json()` in each backend's
  // login() would throw a cryptic SyntaxError, or worse, hang if the target
  // stalls. Preflight once here: fail fast with an actionable message that
  // surfaces to the dashboard scan-issues banner. Real endpoint discovery
  // from the connected repo / Supabase schema is the follow-up that will
  // remove this whole check.
  await assertTargetMatchesTestShape(cfg.appBaseUrl, cfg.accountA);

  const client = new Anthropic({ apiKey });
  const driver = () => createAnthropicDriver(client, model);
  const targetOwnerId = cfg.targetOwnerId ?? DEFAULT_TARGET_OWNER_ID;
  const targetOwnedIds = cfg.targetOwnedIds ?? DEFAULT_TARGET_OWNED_IDS;

  const [bola, authBypass, injection, ssrf, exposure, rlsDeep, weakCrypto] = await Promise.all([
    createTestTargetBolaBackend({
      baseUrl: cfg.appBaseUrl,
      accountA: cfg.accountA,
      accountB: cfg.accountB,
      bOwnedIds: targetOwnedIds,
    }),
    createTestTargetAuthBypassBackend({
      baseUrl: cfg.appBaseUrl,
      accountA: cfg.accountA,
      targetUserId: targetOwnerId,
      targetOwnedIds,
    }),
    createTestTargetInjectionBackend({ baseUrl: cfg.appBaseUrl, accountA: cfg.accountA }),
    createTestTargetSsrfBackend({ baseUrl: cfg.appBaseUrl, accountA: cfg.accountA }),
    createTestTargetExposureBackend({ baseUrl: cfg.appBaseUrl, accountA: cfg.accountA }),
    createTestTargetRlsDeepBackend({
      baseUrl: cfg.appBaseUrl,
      accountA: cfg.accountA,
      targetOwnerId,
    }),
    createTestTargetWeakCryptoBackend({ baseUrl: cfg.appBaseUrl, accountA: cfg.accountA }),
  ]);

  return [
    { specialist: bolaSpecialist as SpecialistEntry<unknown, unknown>["specialist"], backend: bola, driver: driver() },
    { specialist: authBypassSpecialist as SpecialistEntry<unknown, unknown>["specialist"], backend: authBypass, driver: driver() },
    { specialist: injectionSpecialist as SpecialistEntry<unknown, unknown>["specialist"], backend: injection, driver: driver() },
    { specialist: ssrfSpecialist as SpecialistEntry<unknown, unknown>["specialist"], backend: ssrf, driver: driver() },
    { specialist: exposureSpecialist as SpecialistEntry<unknown, unknown>["specialist"], backend: exposure, driver: driver() },
    { specialist: rlsDeepSpecialist as SpecialistEntry<unknown, unknown>["specialist"], backend: rlsDeep, driver: driver() },
    { specialist: weakCryptoSpecialist as SpecialistEntry<unknown, unknown>["specialist"], backend: weakCrypto, driver: driver() },
  ];
}
