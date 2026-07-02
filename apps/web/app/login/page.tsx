"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { authenticate, type AuthState } from "./actions";

export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [state, formAction, pending] = useActionState<AuthState, FormData>(authenticate, null);

  return (
    <div className="relative flex min-h-screen items-center justify-center px-6">
      <div className="aurora" />
      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Link href="/">
            <Logo />
          </Link>
        </div>

        <div className="glass rounded-2xl p-7">
          <h1 className="text-xl font-semibold">
            {mode === "signin" ? "Sign in to Kelp" : "Create your account"}
          </h1>
          <p className="mt-1 text-sm text-fog-400">
            {mode === "signin"
              ? "Welcome back — pick up where you left off."
              : "Start with one free security scan."}
          </p>

          <form action={formAction} className="mt-6 space-y-3">
            <input type="hidden" name="mode" value={mode} />
            <div>
              <label className="mb-1.5 block text-xs font-medium text-fog-400">Email</label>
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@company.com"
                className="w-full rounded-lg border border-line bg-ink-900 px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-aqua-600/60"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-fog-400">Password</label>
              <input
                name="password"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
                minLength={8}
                placeholder="••••••••"
                className="w-full rounded-lg border border-line bg-ink-900 px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-aqua-600/60"
              />
            </div>

            {state?.error && (
              <p className="rounded-lg border border-[color:var(--color-crit)]/30 bg-[color:var(--color-crit)]/10 px-3 py-2 text-xs text-[color:var(--color-crit)]">
                {state.error}
              </p>
            )}

            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-lg bg-gradient-to-r from-aqua-400 to-aqua-600 px-4 py-2.5 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          <div className="mt-5 text-center text-xs text-fog-400">
            {mode === "signin" ? "New to Kelp?" : "Already have an account?"}{" "}
            <button
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="text-aqua-400 transition-colors hover:text-aqua-300"
            >
              {mode === "signin" ? "Create an account" : "Sign in"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
