"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/Button";
import { Logo } from "@/components/Logo";
import { authenticate, signInWithGithubAction, signInWithGoogleAction, type AuthState } from "./actions";

export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [state, formAction, pending] = useActionState<AuthState, FormData>(authenticate, null);
  const searchParams = useSearchParams();
  // OAuth callback bounces users back with `?oauth_error=…` on cancellation
  // or provider failure. Surface it once — it clears on the next mode toggle
  // or form submit, so a stale banner never sticks.
  const oauthError = searchParams.get("oauth_error");

  return (
    <div className="relative flex min-h-screen items-center justify-center px-6">
      <div className="pointer-events-none absolute inset-y-0 left-8 hidden xl:block">
        <div className="filament" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="mb-10 flex justify-center">
          <Link href="/" aria-label="Kelp home">
            <Logo />
          </Link>
        </div>

        <div className="border border-[color:var(--color-hair)] px-8 py-9">
          <div className="eyebrow flex items-center gap-3">
            <span className="h-px w-6 bg-[color:var(--color-hair-strong)]" aria-hidden />
            <span>{mode === "signin" ? "Return" : "Get started"}</span>
          </div>
          <h1 className="font-display mt-4 text-[30px] leading-[1.1] text-[color:var(--color-paper-50)]">
            {mode === "signin" ? "Sign in to Kelp." : "Create your account."}
          </h1>
          <p className="mt-3 text-[13.5px] leading-[1.6] text-[color:var(--color-paper-300)]">
            {mode === "signin"
              ? "Welcome back. Pick up where you left off."
              : "Start with one free security scan — no card, no time limit."}
          </p>

          {/* GitHub is the load-bearing OAuth (#46): consent screen doubles
              as the Kelp App install screen. Primary style (Kelp signal
              accent) so it wins the eye — this is the fewest-clicks path
              from "landing" to "installed and scanning". */}
          <form action={signInWithGithubAction} className="mt-8">
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-3 border bg-transparent px-4 py-3 font-mono text-[12.5px] uppercase tracking-[0.14em] transition-colors"
              style={{
                borderColor: "var(--color-signal-dim)",
                color: "var(--color-signal)",
              }}
            >
              <GithubGlyph />
              Continue with GitHub
            </button>
          </form>

          <form action={signInWithGoogleAction} className="mt-3">
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-3 border border-[color:var(--color-hair-strong)] bg-transparent px-4 py-3 font-mono text-[12.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-100)] transition-colors hover:border-[color:var(--color-signal-dim)] hover:text-[color:var(--color-paper-50)]"
            >
              <GoogleGlyph />
              Continue with Google
            </button>
          </form>

          <div className="mt-6 flex items-center gap-4">
            <div className="h-px flex-1 bg-[color:var(--color-hair)]" />
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
              or with email
            </span>
            <div className="h-px flex-1 bg-[color:var(--color-hair)]" />
          </div>

          {oauthError && !state?.error && (
            <p
              className="mt-6 border-l px-4 py-2 font-mono text-[12px] leading-relaxed"
              style={{
                borderColor: "var(--color-sev-crit)",
                color: "var(--color-sev-crit)",
              }}
            >
              {friendlyOauthError(oauthError)}
            </p>
          )}

          <form action={formAction} className="mt-6 space-y-5">
            <input type="hidden" name="mode" value={mode} />
            <Field label="Email">
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@company.com"
                className="w-full border border-[color:var(--color-hair)] bg-transparent px-0 py-2 text-[14px] text-[color:var(--color-paper-50)] outline-none transition-colors focus:border-[color:var(--color-signal)] placeholder:text-[color:var(--color-paper-500)]"
                style={{ borderWidth: "0 0 1px 0" }}
              />
            </Field>
            <Field label="Password">
              <input
                name="password"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
                minLength={8}
                placeholder="••••••••"
                className="w-full border border-[color:var(--color-hair)] bg-transparent px-0 py-2 text-[14px] text-[color:var(--color-paper-50)] outline-none transition-colors focus:border-[color:var(--color-signal)] placeholder:text-[color:var(--color-paper-500)]"
                style={{ borderWidth: "0 0 1px 0" }}
              />
            </Field>

            {state?.error && (
              <p
                className="border-l px-4 py-2 font-mono text-[12px] leading-relaxed"
                style={{
                  borderColor: "var(--color-sev-crit)",
                  color: "var(--color-sev-crit)",
                }}
              >
                {state.error}
              </p>
            )}

            <Button type="submit" size="lg" disabled={pending} className="mt-2 w-full">
              {pending ? "…" : mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <div className="mt-8 text-center font-mono text-[11.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
            {mode === "signin" ? "New to Kelp?" : "Already have an account?"}{" "}
            <button
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="text-[color:var(--color-signal)] transition-colors hover:text-[color:var(--color-paper-50)]"
            >
              {mode === "signin" ? "Create an account" : "Sign in"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
        {label}
      </div>
      {children}
    </label>
  );
}

/** GitHub Octocat mark. Inline SVG, currentColor — inherits the button's
 *  text colour so it lands on the Kelp signal accent, not the raw GitHub
 *  black-on-white. */
function GithubGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/** Google G — official four-colour mark. Kept as an inline SVG so no external
 *  network request leaks the login page (privacy) and so it renders even when
 *  Google's CDN is blocked. */
function GoogleGlyph() {
  return (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.257h2.908c1.702-1.567 2.684-3.874 2.684-6.614z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
    </svg>
  );
}

/** Provider errors come back as opaque strings (Google's messages, GitHub's,
 *  Supabase wrappers, our own \`missing_code\`/\`exchange_failed\`). Fold them
 *  into a few human sentences so the login banner doesn't shout a stack
 *  trace. Never names the provider — the button label is enough context. */
function friendlyOauthError(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes("access_denied") || s.includes("cancel")) {
    return "Sign-in was cancelled. Give it another go?";
  }
  if (s === "missing_code" || s === "exchange_failed" || s.includes("unable to exchange")) {
    return "Something went wrong finishing sign-in. Try again — if it keeps failing, use email + password below.";
  }
  return "Sign-in didn't complete — try again, or use email + password below.";
}
