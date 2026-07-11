"use client";

import { DatabaseIcon } from "./icons";

export function UnknownBackendCard() {
  return (
    <section className="border border-[color:var(--color-hair)]">
      <div className="flex items-start gap-5 border-b border-[color:var(--color-hair)] px-6 py-5">
        <div
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border"
          style={{ borderColor: "var(--color-hair-strong)", color: "var(--color-paper-400)" }}
        >
          <DatabaseIcon />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
            § Backend · not detected
          </div>
          <h2 className="font-display mt-3 text-[22px] leading-[1.15] text-[color:var(--color-paper-50)]">
            Kelp couldn't identify your backend from the repo.
          </h2>
          <p className="mt-3 max-w-xl text-[13.5px] leading-[1.65] text-[color:var(--color-paper-400)]">
            That's usually because the frontend calls the backend via env vars only, with no
            Supabase/Firebase client committed to the repo. Two ways forward:
          </p>
        </div>
      </div>

      <div className="px-6 py-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div
            className="border p-5"
            style={{ borderColor: "var(--color-signal-dim)" }}
          >
            <div
              className="font-mono text-[10.5px] uppercase tracking-[0.16em]"
              style={{ color: "var(--color-signal)" }}
            >
              § If you use Supabase
            </div>
            <p className="mt-3 text-[13px] leading-[1.65] text-[color:var(--color-paper-300)]">
              Scroll down to Step 01 — paste your project ref + anon key manually. Kelp will pick
              up from there.
            </p>
          </div>
          <div className="border border-[color:var(--color-hair)] p-5">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
              § Different backend?
            </div>
            <p className="mt-3 text-[13px] leading-[1.65] text-[color:var(--color-paper-300)]">
              Active pen-testing today needs Supabase. Passive scans (secrets, GitHub) still run —
              no configuration needed.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
