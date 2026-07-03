"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Resend-register scanning state: restrained motion, generous space, one accent.
// Auto-refreshes the server component while a scan is active so findings replace
// this view the moment the worker finishes.

const PHASES = [
  "Connecting to your project",
  "Reading Supabase schema & RLS policies",
  "Fetching repository contents",
  "Scanning for exposed secrets",
  "Analyzing results",
];

export function ScanningView({ status }: { status: string | null }) {
  const router = useRouter();
  const active = status === "queued" || status === "running";
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!active) return;
    const poll = setInterval(() => router.refresh(), 2000);
    const advance = setInterval(
      () => setPhase((p) => Math.min(p + 1, PHASES.length - 1)),
      1300,
    );
    return () => {
      clearInterval(poll);
      clearInterval(advance);
    };
  }, [active, router]);

  if (!active) return null;

  return (
    <div className="mt-8 flex flex-col items-center rounded-2xl border border-line/60 bg-ink-900/30 px-6 py-16 text-center">
      <div className="relative mb-9 h-24 w-24">
        <span className="absolute inset-0 animate-radar rounded-full border border-aqua-500/40" />
        <span className="absolute inset-0 animate-radar rounded-full border border-aqua-500/40 [animation-delay:0.9s]" />
        <span className="absolute inset-0 m-auto h-2.5 w-2.5 rounded-full bg-aqua-400 shadow-[0_0_12px_2px_rgba(52,230,207,0.5)]" />
      </div>

      <h2 className="text-lg font-medium tracking-tight text-fog-50">Scanning your project</h2>
      <p className="mt-1.5 text-sm text-fog-400">This usually takes a few seconds.</p>

      <ul className="mt-9 w-full max-w-xs space-y-3 text-left">
        {PHASES.map((label, i) => {
          const done = i < phase;
          const current = i === phase;
          return (
            <li key={label} className="flex items-center gap-3 text-sm">
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] transition-colors ${
                  done
                    ? "bg-aqua-500/20 text-aqua-400"
                    : current
                      ? "border border-aqua-500/60"
                      : "border border-line"
                }`}
              >
                {done ? (
                  "✓"
                ) : current ? (
                  <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-aqua-400" />
                ) : null}
              </span>
              <span className={done || current ? "text-fog-200" : "text-fog-600"}>{label}</span>
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
