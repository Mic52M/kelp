"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Resend-register scanning state: restrained motion, generous space, one accent.
// Auto-refreshes the server component while a scan is active so findings replace
// this view the moment the worker finishes.

const PASSIVE_PHASES = [
  "Connecting to your project",
  "Reading Supabase schema & RLS policies",
  "Fetching repository contents",
  "Scanning for exposed secrets",
  "Analyzing results",
];

// The seven multi-agent specialists (#27). Order = campaign dispatch order.
// `pending` marks the four still waiting for repo-based HTTP endpoint
// discovery (Stage B, #27 follow-up) — they run as no-op backends today.
interface ActivePhase {
  label: string;
  pending?: boolean;
}
const ACTIVE_PHASES: ActivePhase[] = [
  { label: "BOLA — cross-account object access" },
  { label: "Auth bypass — impersonation techniques", pending: true },
  { label: "Injection — payload vs baseline diff", pending: true },
  { label: "SSRF — out-of-band callback", pending: true },
  { label: "Exposure — response field-name audit" },
  { label: "RLS-deep — cross-account at the table level" },
  { label: "Weak crypto — Set-Cookie flag audit", pending: true },
];

export function ScanningView({
  status,
  mode = "passive",
  etaSeconds,
}: {
  status: string | null;
  mode?: "passive" | "active_pentest" | null;
  /** Optional caller override for the expected duration in seconds. Falls
   *  back to a mode-based default (passive ~30s, active_pentest ~5min). We
   *  use this both for the human-readable ETA line and to time the phase
   *  checklist so it doesn't sprint through the steps in 20 seconds while
   *  the real campaign takes 5 minutes. */
  etaSeconds?: number;
}) {
  const router = useRouter();
  const active = status === "queued" || status === "running";
  const passivePhases: ActivePhase[] = PASSIVE_PHASES.map((l) => ({ label: l }));
  const phases: ActivePhase[] = mode === "active_pentest" ? ACTIVE_PHASES : passivePhases;
  // Stage A active pen test = 3 real specialists (BOLA, RLS-deep, Exposure)
  // running in parallel — ~90–150s on Haiku 4.5 across a typical Supabase
  // schema. Bumps once the four Stage-B specialists come online.
  const eta = etaSeconds ?? (mode === "active_pentest" ? 150 : 30);
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!active) return;
    // Spread the checklist across the expected duration so the UI doesn't run
    // out of phases before the campaign finishes. Divide by phases.length + 1
    // so the final phase stays visibly in-progress until the server signals
    // done (page refresh flips to results).
    const advanceMs = Math.max(800, Math.floor((eta * 1000) / (phases.length + 1)));
    const poll = setInterval(() => router.refresh(), 2000);
    const advance = setInterval(
      () => setPhase((p) => Math.min(p + 1, phases.length - 1)),
      advanceMs,
    );
    return () => {
      clearInterval(poll);
      clearInterval(advance);
    };
  }, [active, router, eta, phases.length]);

  if (!active) return null;

  const title =
    mode === "active_pentest" ? "Running the multi-agent pen test" : "Scanning your project";
  const etaLabel = formatEta(eta);
  const subtitle =
    mode === "active_pentest"
      ? `Seven specialists probe your app in parallel — usually about ${etaLabel}.`
      : `Usually about ${etaLabel} for a typical repository.`;

  return (
    <div className="mt-8 flex flex-col items-center rounded-2xl border border-line/60 bg-ink-900/30 px-6 py-16 text-center">
      <div className="relative mb-9 h-24 w-24">
        <span className="absolute inset-0 animate-radar rounded-full border border-aqua-500/40" />
        <span className="absolute inset-0 animate-radar rounded-full border border-aqua-500/40 [animation-delay:0.9s]" />
        <span className="absolute inset-0 m-auto h-2.5 w-2.5 rounded-full bg-aqua-400 shadow-[0_0_12px_2px_rgba(52,230,207,0.5)]" />
      </div>

      <h2 className="text-lg font-medium tracking-tight text-fog-50">{title}</h2>
      <p className="mt-1.5 text-sm text-fog-400">{subtitle}</p>

      <ul className="mt-9 w-full max-w-md space-y-3 text-left">
        {phases.map((p, i) => {
          const done = i < phase && !p.pending;
          const current = i === phase && !p.pending;
          return (
            <li key={p.label} className="flex items-center gap-3 text-sm">
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] transition-colors ${
                  p.pending
                    ? "border border-dashed border-line/70 text-fog-600"
                    : done
                      ? "bg-aqua-500/20 text-aqua-400"
                      : current
                        ? "border border-aqua-500/60"
                        : "border border-line"
                }`}
              >
                {p.pending ? (
                  "⧗"
                ) : done ? (
                  "✓"
                ) : current ? (
                  <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-aqua-400" />
                ) : null}
              </span>
              <span
                className={
                  p.pending
                    ? "text-fog-500"
                    : done || current
                      ? "text-fog-200"
                      : "text-fog-600"
                }
              >
                {p.label}
                {p.pending && (
                  <span className="ml-2 text-[10.5px] uppercase tracking-wider text-fog-500">
                    Stage B — coming
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-9 h-1 w-full max-w-xs overflow-hidden rounded-full bg-ink-700">
        <div className="h-full w-full animate-shimmer" />
      </div>
    </div>
  );
}

/** Format an ETA in seconds as "45s", "3 min", "5–6 minutes" style copy. */
function formatEta(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} seconds`;
  const min = Math.round(seconds / 60);
  return min === 1 ? "1 minute" : `${min} minutes`;
}
