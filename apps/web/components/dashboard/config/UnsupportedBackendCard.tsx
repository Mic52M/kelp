"use client";

import { useState } from "react";
import type { BackendReport } from "@kelp/core";
import { buttonClasses } from "@/components/Button";
import { DatabaseIcon, CheckIcon } from "./icons";

export function UnsupportedBackendCard({ report }: { report: BackendReport }) {
  const backend = LABEL[report.primary.type] ?? "your backend";
  const [waitlisted, setWaitlisted] = useState(false);

  return (
    <section
      className="border"
      style={{ borderColor: "var(--color-sev-high)" }}
    >
      <div
        className="flex items-start gap-5 border-b px-6 py-5"
        style={{ borderColor: "var(--color-hair)" }}
      >
        <div
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border"
          style={{ borderColor: "var(--color-sev-high)", color: "var(--color-sev-high)" }}
        >
          <DatabaseIcon />
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="font-mono text-[10.5px] uppercase tracking-[0.16em]"
            style={{ color: "var(--color-sev-high)" }}
          >
            § Detected · {backend}
          </div>
          <h2 className="font-display mt-3 text-[22px] leading-[1.15] text-[color:var(--color-paper-50)]">
            Active pen-testing isn't available for {backend} yet.
          </h2>
          <p className="mt-3 max-w-xl text-[13.5px] leading-[1.65] text-[color:var(--color-paper-300)]">
            Kelp's active pen test currently covers Supabase-based vibe-coded apps (including
            managed Supabase backends). {backend} works differently — its security rules and
            auth model need their own specialist agents, which we're building next.
          </p>
        </div>
      </div>

      <div className="px-6 py-6">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
          § What you can do today
        </div>
        <ul className="mt-4 space-y-3 text-[13.5px] leading-[1.7] text-[color:var(--color-paper-300)]">
          <li className="flex gap-3">
            <CheckIcon
              className="mt-[3px] h-3.5 w-3.5 shrink-0"
              style={{ color: "var(--color-signal)" } as React.CSSProperties}
            />
            <span>
              <span className="text-[color:var(--color-paper-50)]">Passive scans still run</span>{" "}
              on your GitHub repo — secrets in the code, hard-coded credentials, misconfigured
              client bundles. That happens automatically on connect and on every push.
            </span>
          </li>
          <li className="flex gap-3">
            <CheckIcon
              className="mt-[3px] h-3.5 w-3.5 shrink-0"
              style={{ color: "var(--color-signal)" } as React.CSSProperties}
            />
            <span>
              <span className="text-[color:var(--color-paper-50)]">Join the waitlist</span> for{" "}
              {backend} active pen-testing. We'll email you the moment specialist agents ship for
              this stack.
            </span>
          </li>
        </ul>

        <div className="mt-8 flex flex-wrap items-center gap-5">
          {waitlisted ? (
            <span
              className="inline-flex items-center gap-2 border px-4 py-2 font-mono text-[11.5px] uppercase tracking-[0.14em]"
              style={{
                borderColor: "var(--color-signal-dim)",
                color: "var(--color-signal)",
              }}
            >
              <CheckIcon className="h-3.5 w-3.5" />
              You're on the waitlist
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setWaitlisted(true)}
              className={buttonClasses("primary", "md", "cta-lift")}
            >
              Notify me when {backend} is supported
            </button>
          )}
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
            Uses your account email · one email, when we ship
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
