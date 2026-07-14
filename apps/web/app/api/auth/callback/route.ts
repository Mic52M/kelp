// OAuth callback for Supabase Auth providers (#46). Handles the code → session
// exchange, bootstraps the Kelp tenant, and fires product analytics for the
// first-ever sign-in of a given user. Provider-agnostic today (Google is the
// only wired provider); the GitHub branch will slot in behind `provider=github`
// once #46 lands.
//
// Server-to-server-ish: the Supabase Auth cookie set here is what makes the
// dashboard's server components see the signed-in user. Never trust query
// params for authorization — the session is authoritative.

import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { ensureTenant } from "@/lib/tenant";
import { track, identify, identityForUser } from "@/lib/analytics";
import { registerGithubInstallation } from "@kelp/worker";

/** Redirect targets that aren't safe paths on our origin are dropped so a
 *  crafted `next=https://evil.com` can't turn the callback into an open
 *  redirector. Only accept relative paths that begin with a single `/`. */
function safeNext(raw: string | null): string {
  if (!raw) return "/dashboard";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));

  // Supabase surfaces provider errors as `error` + `error_description` on the
  // callback URL. Surface them to the login page as an inline banner — never
  // 500 on an OAuth user cancelling consent.
  const providerError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (providerError) {
    return NextResponse.redirect(
      new URL(`/login?oauth_error=${encodeURIComponent(providerError)}`, req.url),
    );
  }

  if (!code) {
    return NextResponse.redirect(new URL("/login?oauth_error=missing_code", req.url));
  }

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data?.user) {
    return NextResponse.redirect(
      new URL(`/login?oauth_error=${encodeURIComponent(error?.message ?? "exchange_failed")}`, req.url),
    );
  }

  const user = data.user;
  const provider = user.app_metadata?.provider ?? "google";

  // Bootstrap the Kelp tenant. Grab the orgId — we need it below for the
  // GitHub install-attribution branch. Best-effort on error: the next
  // authenticated request retries ensureTenant at request time. If we
  // couldn't get an orgId, the GitHub install-registration is skipped
  // (it will run via the standard /api/github/setup callback when the user
  // installs the App from Onboarding).
  let orgId: string | null = null;
  if (user.email) {
    try {
      const bootstrap = await ensureTenant({ id: user.id, email: user.email });
      orgId = bootstrap.orgId;
    } catch {
      /* retried on the next authenticated request */
    }
  }

  // GitHub OAuth (#46): the consent screen the user just approved requested
  // `repo read:user user:email`, i.e. the exact scopes the Kelp GitHub App
  // needs. Supabase exposes the resulting GitHub access token as
  // `session.provider_token`. Use it to find which of the user's App
  // installations is ours (matched by GITHUB_APP_ID) and register it — so
  // signup + install collapse into one click. If the user authenticated but
  // didn't install the App (e.g. they cancelled the install screen), fall
  // back to the standard install URL so they don't land on an empty
  // dashboard.
  let nextRedirect = next;
  if (provider === "github" && orgId) {
    try {
      nextRedirect = await handleGithubInstallAttribution(orgId, user.id, next);
    } catch (e) {
      console.warn(
        "github install attribution failed:",
        e instanceof Error ? e.message : e,
      );
      /* fall through to the default next redirect */
    }
  }

  // Product analytics (#34): identify + signup.completed on first-ever
  // sign-in. Distinguishing first sign-in from subsequent ones is what
  // `data.session` alone doesn't tell us, so we lean on the auth user's
  // `created_at` — within 60s of "now" is a fresh signup. This is fuzzy on
  // the edge but honest: no separate table lookup, no accidental
  // double-firing on returning users. `method` matches password/google/github.
  const ident = identityForUser(user);
  if (ident) {
    identify(ident.distinctId, ident.email_sha256 ? { email_sha256: ident.email_sha256 } : {});
    const createdMs = user.created_at ? Date.parse(user.created_at) : NaN;
    const isFreshSignup = Number.isFinite(createdMs) && Date.now() - createdMs < 60_000;
    if (isFreshSignup) {
      track(ident.distinctId, "signup.completed", { method: provider });
    }
  }

  return NextResponse.redirect(new URL(nextRedirect, req.url));
}

/** Look up the user's GitHub App installations via the OAuth token Supabase
 *  cached on the session, match one to the Kelp App by `app_id`, and
 *  register it against the caller's org. Always returns the caller's
 *  requested `next` — no side redirect. When no matching install is found
 *  the user lands on Onboarding via the normal flow, where the standard
 *  install flow (which uses \`/api/github/setup\` as its Setup URL, NOT the
 *  Supabase Auth callback) can register them without cross-contamination
 *  with the OAuth state. Attempting the install redirect from here bounces
 *  through GitHub → Supabase's Callback URL → \`bad_oauth_state\` error → \`/\`. */
async function handleGithubInstallAttribution(
  orgId: string,
  userId: string,
  next: string,
): Promise<string> {
  const supabase = await getServerSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const providerToken = sessionData?.session?.provider_token;
  if (!providerToken) return next;

  const appIdRaw = process.env.GITHUB_APP_ID;
  const kelpAppId = appIdRaw ? Number(appIdRaw) : NaN;
  if (!Number.isFinite(kelpAppId)) {
    console.warn("GITHUB_APP_ID missing or invalid — cannot attribute installation");
    return next;
  }

  // GET /user/installations returns every App the user has installed on any
  // account they own. We filter for ours. `per_page=100` is the max — a
  // realistic user has < 20 installations, so pagination is overkill here.
  const res = await fetch("https://api.github.com/user/installations?per_page=100", {
    headers: {
      Authorization: `Bearer ${providerToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`GET /user/installations returned ${res.status}`);
  }
  const body = (await res.json()) as { installations?: Array<{ id: number; app_id: number }> };
  const ours = (body.installations ?? []).find((i) => i.app_id === kelpAppId);

  if (!ours) {
    // Authenticated but no Kelp App installation yet — land on the requested
    // next (default /dashboard). Onboarding's "Install the Kelp GitHub App"
    // button drives the install through the setup callback with the correct
    // state; doing it from here would collide with Supabase's OAuth state.
    return next;
  }

  await registerGithubInstallation({
    orgId,
    installationId: ours.id,
    connectedBy: userId,
  });
  return next;
}
