// Real Supabase Auth for the active pen test (#27 follow-up, Stage A).
//
// Replaces the test-target's toy POST /api/login with the endpoint every real
// Supabase-backed app actually uses:
//
//   POST https://<ref>.supabase.co/auth/v1/token?grant_type=password
//   apikey:        <anon key — public by design>
//   Authorization: (not required for grant_type=password)
//   Body:          { email, password }
//
// Returns { access_token, refresh_token, user: { id, ... }, ... }. The access
// token is a real Postgres JWT signed by the project — good for PostgREST at
// /rest/v1/* and for anything else the customer's app fronts by the Supabase
// session (RLS then applies as if the user was signed in via the app).
//
// Kept deliberately small: one login helper, one anon-key resolver. The
// specialist backends compose these — they never see the raw fetch.

/** One Supabase-Auth session, cached across a campaign so the seven specialists
 *  share one login round-trip per account instead of hammering /auth/v1. */
export interface SupabaseSession {
  /** the JWT to send as Authorization: Bearer <accessToken> */
  accessToken: string;
  /** the auth.users.id — used to filter own rows vs cross-account rows */
  userId: string;
  /** the email that was used (for the report / audit) */
  email: string;
}

/** Build the base Supabase URL from a project ref. Kelp doesn't need to store
 *  it separately — it's always `https://<ref>.supabase.co`. */
export function supabaseBaseUrl(ref: string): string {
  return `https://${ref}.supabase.co`;
}

/**
 * Log in one test account. Robust to whatever the customer's Supabase Auth
 * config happens to be:
 *
 *   1. Try grant_type=password with the stored credentials.
 *   2. On 400 / 422 (typical "invalid_credentials", "email not confirmed",
 *      CAPTCHA required, MFA required, …) AND a service_role key is
 *      available → look the user up in auth.users by email, then generate
 *      a magic-link and verify it to mint a real session.
 *
 * The fallback path bypasses password validation entirely — Kelp is
 * impersonating the user via an operator-scoped admin flow, which is fair
 * for a pen test the org owner explicitly consented to. Falls back only
 * when the service_role is present; without it the caller sees the original
 * password error (unchanged UX for people who didn't provide a mgmt PAT).
 */
export async function loginSupabaseUser(input: {
  ref: string;
  anonKey: string;
  email: string;
  password: string;
  /** Optional service-role key. When present, Kelp falls back to admin-
   *  impersonation on password failure. Never sent for the primary path. */
  serviceRoleKey?: string | null;
}): Promise<SupabaseSession> {
  const primary = await tryPasswordLogin(input);
  if (primary.ok) return primary.session;

  // Password failed. If we can, escalate to admin impersonation — otherwise
  // surface the primary failure as-is.
  if (!input.serviceRoleKey) {
    throw primary.error;
  }
  try {
    return await adminImpersonate({
      ref: input.ref,
      anonKey: input.anonKey,
      serviceRoleKey: input.serviceRoleKey,
      email: input.email,
    });
  } catch (fallbackErr) {
    // Both paths failed — bubble up the more informative message.
    const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
    throw new Error(
      `${primary.error.message} Admin impersonation fallback also failed: ${fbMsg}`,
    );
  }
}

/** Password grant. Returns {ok:false, error} on ANY non-2xx so the caller
 *  can decide whether to fall back — throws only on network/timeout. */
async function tryPasswordLogin(input: {
  ref: string;
  anonKey: string;
  email: string;
  password: string;
}): Promise<
  | { ok: true; session: SupabaseSession }
  | { ok: false; error: Error }
> {
  const url = `${supabaseBaseUrl(input.ref)}/auth/v1/token?grant_type=password`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: input.anonKey },
      body: JSON.stringify({ email: input.email, password: input.password }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Kelp couldn't reach Supabase Auth (${url}) within 8s: ${msg}. ` +
        `Check the Supabase project ref and that the project isn't paused.`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      ok: false,
      error: new Error(
        `Supabase Auth rejected ${input.email} with HTTP ${res.status}: ${body.slice(0, 160)}. ` +
          `Verify the test-account email + password in Configuration.`,
      ),
    };
  }
  const data = (await res.json()) as { access_token?: string; user?: { id?: string } };
  if (!data.access_token || !data.user?.id) {
    return {
      ok: false,
      error: new Error(
        `Supabase Auth returned an unexpected shape for ${input.email} — ` +
          `Kelp needs { access_token, user: { id } }.`,
      ),
    };
  }
  return {
    ok: true,
    session: { accessToken: data.access_token, userId: data.user.id, email: input.email },
  };
}

/**
 * Admin impersonation via `generate_link(magiclink)` → `verify(magiclink)`.
 * Requires the service_role key. The magic-link path is universally available
 * on every Supabase project (there's no way to disable /auth/v1/verify while
 * keeping auth working). Bypasses password, email-confirm, CAPTCHA, and MFA.
 */
async function adminImpersonate(input: {
  ref: string;
  anonKey: string;
  serviceRoleKey: string;
  email: string;
}): Promise<SupabaseSession> {
  const base = supabaseBaseUrl(input.ref);
  const genRes = await fetch(`${base}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: input.serviceRoleKey,
      Authorization: `Bearer ${input.serviceRoleKey}`,
    },
    body: JSON.stringify({ type: "magiclink", email: input.email }),
    signal: AbortSignal.timeout(8000),
  });
  if (!genRes.ok) {
    const body = await genRes.text().catch(() => "");
    throw new Error(
      `admin/generate_link failed with HTTP ${genRes.status}: ${body.slice(0, 160)}. ` +
        `Is the service-role key correct, and does the user ${input.email} exist in auth.users?`,
    );
  }
  // generate_link returns two token shapes — `email_otp` (a short OTP the
  // JSON /auth/v1/verify endpoint accepts alongside the email) and
  // `hashed_token` (used by the browser-style GET /auth/v1/verify?token=…
  // redirect flow). Kelp uses the OTP path because it's a single JSON POST.
  const genData = (await genRes.json()) as {
    email_otp?: string;
    properties?: { email_otp?: string };
  };
  const emailOtp = genData.email_otp ?? genData.properties?.email_otp;
  if (!emailOtp) {
    throw new Error(
      `admin/generate_link returned an unexpected shape for ${input.email} — no email_otp`,
    );
  }

  const vRes = await fetch(`${base}/auth/v1/verify`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: input.anonKey },
    body: JSON.stringify({ type: "magiclink", email: input.email, token: emailOtp }),
    signal: AbortSignal.timeout(8000),
  });
  if (!vRes.ok) {
    const body = await vRes.text().catch(() => "");
    throw new Error(
      `auth/v1/verify failed with HTTP ${vRes.status}: ${body.slice(0, 160)}`,
    );
  }
  const vData = (await vRes.json()) as { access_token?: string; user?: { id?: string } };
  if (!vData.access_token || !vData.user?.id) {
    throw new Error(
      `auth/v1/verify returned an unexpected shape for ${input.email} — Kelp needs { access_token, user: { id } }`,
    );
  }
  return { accessToken: vData.access_token, userId: vData.user.id, email: input.email };
}

/**
 * Resolve the anon key for a project. Two paths, tried in order:
 *   1. explicit — the user pasted the anon key in Configuration (stored as
 *      credential kind `supabase_anon_key`);
 *   2. auto-fetch — if the project has a legacy management PAT, ask the
 *      Management API for the anon key and cache it back through
 *      `putCredential` so the next scan skips the API round-trip.
 * Throws with a clear "add the anon key or a management PAT in Configuration"
 * message when neither is available.
 */
export async function resolveAnonKey(input: {
  projectRef: string;
  explicitAnonKey: string | null;
  managementPat: string | null;
  onDiscovered?: ((anonKey: string) => Promise<void>) | undefined;
}): Promise<string> {
  if (input.explicitAnonKey) return input.explicitAnonKey;
  if (!input.managementPat) {
    throw new Error(
      "Kelp needs your Supabase anon key to log in as the test accounts. " +
        "Add it under Configuration → Supabase anon key (it's public by design — " +
        "the same value your app embeds in the browser), or provide a Supabase " +
        "Management API token so Kelp can fetch it for you.",
    );
  }
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${input.projectRef}/api-keys`,
    { headers: { Authorization: `Bearer ${input.managementPat}` } },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Supabase Management API refused to list api-keys for project ${input.projectRef} ` +
        `(HTTP ${res.status}: ${body.slice(0, 120)}). Add the anon key manually in Configuration.`,
    );
  }
  const keys = (await res.json()) as Array<{ name?: string; api_key?: string }>;
  const anon = keys.find((k) => k.name === "anon")?.api_key;
  if (!anon) {
    throw new Error(
      `Supabase Management API returned no anon key for project ${input.projectRef}. ` +
        `Add it manually in Configuration.`,
    );
  }
  if (input.onDiscovered) {
    // Fire-and-forget: cache the anon key so subsequent scans skip the round-
    // trip. Failure here (e.g. write conflict) is not fatal — we just log.
    await input.onDiscovered(anon).catch((e: unknown) => {
      console.warn("could not cache anon key:", e instanceof Error ? e.message : e);
    });
  }
  return anon;
}

/**
 * Resolve the service-role key, same shape as resolveAnonKey but service_role
 * is a SECRET (never embed in the browser) so no explicit-paste field is
 * exposed — only the Management-PAT auto-fetch path. Returns null when no
 * PAT is available; caller then skips the admin-impersonation fallback.
 */
export async function resolveServiceRoleKey(input: {
  projectRef: string;
  managementPat: string | null;
  onDiscovered?: ((serviceRole: string) => Promise<void>) | undefined;
  /** When set, resolveServiceRoleKey short-circuits with the stored value
   *  instead of hitting the Management API. */
  cachedServiceRole?: string | null | undefined;
}): Promise<string | null> {
  if (input.cachedServiceRole) return input.cachedServiceRole;
  if (!input.managementPat) return null;
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${input.projectRef}/api-keys`,
    { headers: { Authorization: `Bearer ${input.managementPat}` } },
  );
  if (!res.ok) return null;
  const keys = (await res.json()) as Array<{ name?: string; api_key?: string }>;
  const sr = keys.find((k) => k.name === "service_role")?.api_key;
  if (!sr) return null;
  if (input.onDiscovered) {
    await input.onDiscovered(sr).catch((e: unknown) => {
      console.warn("could not cache service_role key:", e instanceof Error ? e.message : e);
    });
  }
  return sr;
}
