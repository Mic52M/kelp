"use client";

import Link from "next/link";
import { useState } from "react";
import { Logo } from "@/components/Logo";

const STEPS = ["Connect GitHub", "Connect Supabase", "Authorize testing", "Scan"] as const;

// The exact consent copy the user must actively agree to. Unchecked by default;
// the BOLA (active) test cannot start unless this is true. Versioned so we can
// store which wording was agreed to.
const CONSENT_VERSION = "v1";
const CONSENT_TEXT =
  "I authorize Kelp to run active security tests — including simulated " +
  "unauthorized-access attempts — against the connected project, which I own or " +
  "am authorized to test.";

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const [githubConnected, setGithubConnected] = useState(false);
  const [supabaseToken, setSupabaseToken] = useState("");
  const [accountA, setAccountA] = useState("");
  const [accountB, setAccountB] = useState("");
  const [consent, setConsent] = useState(false); // never pre-checked

  const canNext =
    (step === 0 && githubConnected) ||
    (step === 1 && supabaseToken.trim().length > 0) ||
    step === 2 || // active testing is optional; consent gates it, not progress
    step === 3;

  // BOLA runs only if the user gave both test accounts AND consent.
  const bolaEnabled = consent && accountA.trim() !== "" && accountB.trim() !== "";

  return (
    <div className="relative min-h-screen">
      <div className="aurora" />
      <header className="relative z-10 mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
        <Link href="/">
          <Logo />
        </Link>
        <span className="text-sm text-fog-400">Step {step + 1} of {STEPS.length}</span>
      </header>

      <main className="relative z-10 mx-auto max-w-3xl px-6 pb-24">
        {/* Progress rail */}
        <div className="mb-10 flex items-center gap-2">
          {STEPS.map((label, i) => (
            <div key={label} className="flex flex-1 items-center gap-2">
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium ${
                  i < step
                    ? "border-aqua-600/50 bg-aqua-500/20 text-aqua-400"
                    : i === step
                      ? "border-aqua-500 bg-aqua-500 text-ink-950"
                      : "border-line bg-ink-800 text-fog-500"
                }`}
              >
                {i < step ? "✓" : i + 1}
              </div>
              <span className={`hidden text-xs sm:block ${i === step ? "text-fog-50" : "text-fog-500"}`}>
                {label}
              </span>
              {i < STEPS.length - 1 && <div className="h-px flex-1 bg-line" />}
            </div>
          ))}
        </div>

        <div className="glass rounded-2xl p-7">
          {step === 0 && (
            <Panel
              title="Connect your GitHub repository"
              subtitle="Kelp reads your code to find leaked secrets and opens fix PRs. Minimal scopes: read repository contents and write pull requests. Never admin."
            >
              {githubConnected ? (
                <div className="flex items-center gap-2 rounded-lg border border-aqua-600/40 bg-aqua-500/10 px-4 py-3 text-sm text-aqua-400">
                  ✓ Connected · acme/roamly-app
                </div>
              ) : (
                <button
                  onClick={() => setGithubConnected(true)}
                  className="inline-flex items-center gap-2 rounded-lg bg-fog-50 px-4 py-2.5 text-sm font-medium text-ink-950 transition-opacity hover:opacity-90"
                >
                  Authorize with GitHub
                </button>
              )}
            </Panel>
          )}

          {step === 1 && (
            <Panel
              title="Connect your Supabase project"
              subtitle="Kelp reads your schema and RLS policies through the Management API. Create a read-scoped access token — you do not need to share your service_role key."
            >
              <label className="mb-1.5 block text-xs font-medium text-fog-400">
                Supabase Management API token
              </label>
              <input
                value={supabaseToken}
                onChange={(e) => setSupabaseToken(e.target.value)}
                type="password"
                placeholder="sbp_..."
                className="w-full rounded-lg border border-line bg-ink-900 px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-aqua-600/60"
              />
              <p className="mt-2 text-xs text-fog-500">
                Stored encrypted at rest. We request the narrowest scope that lets us read your
                schema.
              </p>
            </Panel>
          )}

          {step === 2 && (
            <Panel
              title="Authorize active testing (optional)"
              subtitle="To test for broken object-level authorization (BOLA) — the flaw behind the Lovable and Moltbook breaches — Kelp signs in as two of your own test users and checks whether one can reach the other's data. This is optional."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-fog-400">Test account A</label>
                  <input
                    value={accountA}
                    onChange={(e) => setAccountA(e.target.value)}
                    placeholder="a@test.dev"
                    className="w-full rounded-lg border border-line bg-ink-900 px-3.5 py-2.5 text-sm outline-none focus:border-aqua-600/60"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-fog-400">Test account B</label>
                  <input
                    value={accountB}
                    onChange={(e) => setAccountB(e.target.value)}
                    placeholder="b@test.dev"
                    className="w-full rounded-lg border border-line bg-ink-900 px-3.5 py-2.5 text-sm outline-none focus:border-aqua-600/60"
                  />
                </div>
              </div>

              <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-ink-900/60 p-4">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--color-aqua-500)]"
                />
                <span className="text-sm leading-relaxed text-fog-300">{CONSENT_TEXT}</span>
              </label>

              <div
                className={`mt-3 flex items-center gap-2 text-xs ${
                  bolaEnabled ? "text-aqua-400" : "text-fog-500"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${bolaEnabled ? "bg-aqua-400" : "bg-fog-600"}`} />
                {bolaEnabled
                  ? "Active BOLA testing will run on this scan."
                  : "Active BOLA testing is off. Add both test accounts and check the box to enable it — the rest of the scan runs regardless."}
              </div>
            </Panel>
          )}

          {step === 3 && (
            <Panel
              title="Ready to scan"
              subtitle="Kelp will check Row Level Security and exposed secrets on your project now."
            >
              <ul className="space-y-2 text-sm text-fog-300">
                <li className="flex items-center gap-2"><span className="text-aqua-400">✓</span> Row Level Security analysis</li>
                <li className="flex items-center gap-2"><span className="text-aqua-400">✓</span> Secret & credential scan</li>
                <li className="flex items-center gap-2">
                  <span className={bolaEnabled ? "text-aqua-400" : "text-fog-600"}>
                    {bolaEnabled ? "✓" : "—"}
                  </span>
                  Active BOLA testing {bolaEnabled ? "(authorized)" : "(not authorized — skipped)"}
                </li>
              </ul>
              <Link
                href="/dashboard"
                className="mt-6 inline-block rounded-lg bg-gradient-to-r from-aqua-400 to-aqua-600 px-5 py-2.5 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90"
              >
                Start scan
              </Link>
              <input type="hidden" name="consentVersion" value={CONSENT_VERSION} />
            </Panel>
          )}

          {/* Nav */}
          {step < 3 && (
            <div className="mt-7 flex items-center justify-between border-t border-line/70 pt-5">
              <button
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0}
                className="text-sm text-fog-400 transition-colors hover:text-fog-50 disabled:opacity-30"
              >
                Back
              </button>
              <button
                onClick={() => setStep((s) => s + 1)}
                disabled={!canNext}
                className="rounded-lg bg-fog-50 px-4 py-2 text-sm font-medium text-ink-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
              >
                Continue
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="animate-rise">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-fog-300">{subtitle}</p>
      <div className="mt-6">{children}</div>
    </div>
  );
}
