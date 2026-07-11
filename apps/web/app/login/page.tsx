"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { Logo } from "@/components/Logo";
import { authenticate, type AuthState } from "./actions";

export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [state, formAction, pending] = useActionState<AuthState, FormData>(authenticate, null);

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

          <form action={formAction} className="mt-8 space-y-5">
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
