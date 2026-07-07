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
 * Log in one test account against real Supabase Auth. Times out at 8s so a
 * dead network doesn't hang the campaign. Throws with an actionable error the
 * scan-issues banner can render verbatim.
 */
export async function loginSupabaseUser(input: {
  ref: string;
  anonKey: string;
  email: string;
  password: string;
}): Promise<SupabaseSession> {
  const url = `${supabaseBaseUrl(input.ref)}/auth/v1/token?grant_type=password`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: input.anonKey,
      },
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
    throw new Error(
      `Supabase Auth rejected ${input.email} with HTTP ${res.status}: ${body.slice(0, 160)}. ` +
        `Verify the test-account email + password in Configuration.`,
    );
  }
  const data = (await res.json()) as {
    access_token?: string;
    user?: { id?: string };
  };
  if (!data.access_token || !data.user?.id) {
    throw new Error(
      `Supabase Auth returned an unexpected shape for ${input.email} — ` +
        `Kelp needs { access_token, user: { id } }.`,
    );
  }
  return { accessToken: data.access_token, userId: data.user.id, email: input.email };
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
