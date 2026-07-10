"use client";

import { useState } from "react";
import type { BackendReport } from "@kelp/core";
import { DatabaseIcon, CheckIcon } from "./icons";

/**
 * Card shown when the analyzer identifies a backend that Kelp's active pen
 * test doesn't cover today (Firebase, Convex, custom-API). The tone is
 * honest — Kelp names what it does today ("Passive scans still run") and
 * what it doesn't ("Active pen-test needs Supabase") — with a waitlist
 * opt-in so the user gets notified when support ships.
 */
export function UnsupportedBackendCard({ report }: { report: BackendReport }) {
  const backend = LABEL[report.primary.type] ?? "your backend";
  const [waitlisted, setWaitlisted] = useState(false);

  return (
    <section className="rounded-2xl border border-amber-500/25 bg-gradient-to-br from-amber-500/[0.04] to-transparent">
      <div className="flex items-start gap-4 border-b border-amber-500/20 px-6 py-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/12 text-amber-300">
          <DatabaseIcon />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-amber-300">
            Detected: {backend}
          </div>
          <h2 className="mt-0.5 text-lg font-semibold tracking-tight text-fog-100">
            Active pen-testing isn't available for {backend} yet
          </h2>
          <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-fog-300">
            Kelp's active pen test currently covers Supabase-based apps (including
            Lovable Cloud, Bolt, and v0). {backend} works differently — its security
            rules and auth model need their own specialist agents, which we're
            building next.
          </p>
        </div>
      </div>

      <div className="px-6 py-5">
        <div className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-fog-500">
          What you can do today
        </div>
        <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-fog-300">
          <li className="flex gap-2.5">
            <CheckIcon className="mt-1 h-3.5 w-3.5 shrink-0 text-aqua-300" />
            <span>
              <b className="text-fog-100">Passive scans still run</b> on your GitHub
              repo — secrets in the code, hard-coded credentials, misconfigured
              client bundles. That happens automatically on connect and on every
              push.
            </span>
          </li>
          <li className="flex gap-2.5">
            <CheckIcon className="mt-1 h-3.5 w-3.5 shrink-0 text-aqua-300" />
            <span>
              <b className="text-fog-100">Join the waitlist</b> for {backend} active
              pen-testing. We'll email you the moment specialist agents ship for
              this stack.
            </span>
          </li>
        </ul>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setWaitlisted(true)}
            disabled={waitlisted}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
              waitlisted
                ? "cursor-default border border-aqua-600/30 bg-aqua-500/[0.06] text-aqua-300"
                : "bg-gradient-to-r from-aqua-400 to-aqua-600 text-ink-950 shadow-sm shadow-aqua-500/10"
            }`}
          >
            {waitlisted ? (
              <>
                <CheckIcon className="h-4 w-4" />
                You're on the waitlist
              </>
            ) : (
              <>Notify me when {backend} is supported</>
            )}
          </button>
          <span className="text-[12px] text-fog-500">
            Uses your account email. One notification, when we ship.
          </span>
        </div>
      </div>
    </section>
  );
}

const LABEL: Partial<Record<BackendReport["primary"]["type"], string>> = {
  firebase: "Firebase",
  convex: "Convex",
  "custom-api": "your custom API",
};
