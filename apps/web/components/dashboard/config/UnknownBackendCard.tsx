"use client";

import { DatabaseIcon } from "./icons";

/**
 * Rendered when the analyzer couldn't identify a backend from the repo.
 * Two paths: (1) point the user at Configuration's manual entry (Step 1
 * BackendCard) — Supabase / Lovable Cloud users who committed nothing to
 * their repo can still finish setup by hand; (2) tell us what backend it
 * actually is so we can extend detection.
 */
export function UnknownBackendCard() {
  return (
    <section className="rounded-2xl border border-line/70 bg-ink-900/40">
      <div className="flex items-start gap-4 border-b border-line/60 px-6 py-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-800/70 text-fog-400">
          <DatabaseIcon />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-fog-500">
            Backend not detected
          </div>
          <h2 className="mt-0.5 text-lg font-semibold tracking-tight text-fog-100">
            Kelp couldn't identify your backend from the repo
          </h2>
          <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-fog-400">
            That's usually because the frontend calls the backend via env vars only,
            with no Supabase/Firebase client committed to the repo. Two ways
            forward:
          </p>
        </div>
      </div>

      <div className="px-6 py-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-line/60 bg-ink-950/40 p-4">
            <div className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-aqua-300">
              If you use Supabase
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-fog-300">
              Scroll down to Step 1 — paste your project ref + anon key manually.
              Kelp will pick up from there.
            </p>
          </div>
          <div className="rounded-xl border border-line/60 bg-ink-950/40 p-4">
            <div className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-fog-500">
              Different backend?
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-fog-300">
              Active pen-testing today needs Supabase. Passive scans (secrets,
              GitHub) still run — no configuration needed.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
