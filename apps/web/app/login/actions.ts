"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { ensureTenant } from "@/lib/tenant";
import { track, identify, identityForUser } from "@/lib/analytics";

export type AuthState = { error: string } | null;

/** Sign in or sign up with email + password, then bootstrap the tenant. */
export async function authenticate(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const mode = String(formData.get("mode") ?? "signin");
  if (!email || !password) return { error: "Enter an email and password." };

  const supabase = await getServerSupabase();

  const { data, error } =
    mode === "signup"
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });

  if (error) return { error: error.message };

  const user = data.user;
  if (user?.email) {
    // signUp with email confirmation disabled returns a session; if confirmation
    // is on, there is no session yet and bootstrap happens on first real login.
    try {
      await ensureTenant({ id: user.id, email: user.email });
    } catch {
      /* bootstrap retried on next authenticated request */
    }
    // Product analytics (#34): fire signup.completed only for the signup
    // path — signin fires an implicit page.viewed via the client provider,
    // which is enough for retention math. identify() runs both ways so
    // events under this distinctId carry the (hashed) email property.
    // `method` distinguishes password from google (#46 will add "github").
    const ident = identityForUser(user);
    if (ident) {
      identify(ident.distinctId, {
        ...(ident.email_sha256 ? { email_sha256: ident.email_sha256 } : {}),
      });
      if (mode === "signup") {
        track(ident.distinctId, "signup.completed", { method: "password" });
      }
    }
  }

  redirect("/dashboard");
}

/** Build an absolute origin from the incoming request. Used to construct
 *  OAuth redirectTo URLs that work in local dev, preview, and prod without a
 *  KELP_APP_URL round-trip. */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

/** Kick off Google OAuth via Supabase Auth (#46 sibling; Google shipped
 *  standalone). Redirects the browser to Google's consent screen; the
 *  callback at /api/auth/callback handles code exchange, tenant bootstrap,
 *  and analytics identify + signup.completed on first-ever sign-in. */
export async function signInWithGoogleAction(): Promise<void> {
  const supabase = await getServerSupabase();
  const origin = await requestOrigin();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/api/auth/callback?next=/dashboard`,
      // Standard OIDC scopes — email + profile. No offline access; Supabase
      // manages the session refresh via its own cookie.
      scopes: "openid email profile",
    },
  });
  if (error || !data?.url) {
    redirect(`/login?oauth_error=${encodeURIComponent(error?.message ?? "google_oauth_unavailable")}`);
  }
  redirect(data.url);
}

/** Kick off GitHub OAuth via Supabase Auth (#46). Requests the same scopes
 *  the Kelp GitHub App needs (\`repo read:user user:email\`) so the consent
 *  screen doubles as the App install screen — one click covers signup +
 *  install. The callback at /api/auth/callback matches the returned
 *  provider_token against GITHUB_APP_ID via GET /user/installations and
 *  registers the installation for the caller's org; users who authenticate
 *  without installing land on the standard install fallback. */
export async function signInWithGithubAction(): Promise<void> {
  const supabase = await getServerSupabase();
  const origin = await requestOrigin();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo: `${origin}/api/auth/callback?next=/dashboard`,
      // `repo` covers private repos too (Kelp needs to read source for the
      // secret scanner + edge fn / RLS analyzers on private customer code).
      // `read:user`+`user:email` are cosmetic — they let PostHog and the
      // dashboard render the account name without an extra API call.
      scopes: "repo read:user user:email",
    },
  });
  if (error || !data?.url) {
    redirect(`/login?oauth_error=${encodeURIComponent(error?.message ?? "github_oauth_unavailable")}`);
  }
  redirect(data.url);
}

export async function signOut() {
  const supabase = await getServerSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}
