"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { runBackendAnalyzerAction } from "@/app/dashboard/configuration/actions";
import { CheckIcon, DatabaseIcon } from "./icons";

const STEPS = [
  "Reading your repo",
  "Detecting your backend",
  "Extracting public config",
  "Preparing your setup",
];

/**
 * Loading card shown when a project has no BackendReport yet. Kicks off
 * the analyzer in the background via a server action and cycles through
 * status steps. When the action returns, refreshes the page so the parent
 * server component re-renders with the fresh brief.
 */
export function AnalyzingCard({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const interval = setInterval(() => {
      setStepIndex((s) => (s < STEPS.length - 1 ? s + 1 : s));
    }, 1600);
    (async () => {
      try {
        const res = await runBackendAnalyzerAction(projectId, "auto");
        if (cancelled) return;
        if (res.ok) {
          setStepIndex(STEPS.length - 1);
          router.refresh();
        } else {
          setError(res.message);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Analyzer failed.");
      }
    })();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId, router]);

  return (
    <section className="rounded-2xl border border-aqua-600/25 bg-gradient-to-br from-aqua-500/[0.06] to-aqua-500/[0.02] p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-aqua-500/15 text-aqua-300">
          <DatabaseIcon />
        </div>
        <div className="flex-1">
          <div className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-aqua-300">
            Analyzing your project
          </div>
          <h2 className="mt-0.5 text-lg font-semibold tracking-tight text-fog-100">
            {error ? "Analysis paused" : "Kelp is looking at your repo"}
          </h2>
          <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-fog-300">
            {error
              ? "You can still finish setup manually below. Kelp will retry on your next visit."
              : "This takes a few seconds — we're identifying your backend, extracting the public config it committed, and mapping the auth flow."}
          </p>
        </div>
      </div>

      <ol className="mt-6 space-y-2">
        {STEPS.map((s, i) => {
          const state =
            i < stepIndex
              ? "done"
              : i === stepIndex && !error
                ? "active"
                : error && i >= stepIndex
                  ? "idle"
                  : "idle";
          return (
            <li
              key={s}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors ${
                state === "done"
                  ? "text-fog-300"
                  : state === "active"
                    ? "bg-aqua-500/[0.06] text-fog-100"
                    : "text-fog-500"
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                  state === "done"
                    ? "bg-aqua-500/20 text-aqua-300"
                    : state === "active"
                      ? "border border-aqua-500/40 text-aqua-300"
                      : "border border-line/60 text-fog-500"
                }`}
              >
                {state === "done" ? (
                  <CheckIcon className="h-3 w-3" />
                ) : state === "active" ? (
                  <Spinner />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-fog-600" />
                )}
              </span>
              <span>{s}</span>
            </li>
          );
        })}
      </ol>

      {error && (
        <p className="mt-4 rounded-lg border border-crit/30 bg-crit/[0.06] px-3 py-2 text-[12.5px] text-crit">
          {error}
        </p>
      )}
    </section>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3 animate-spin" aria-hidden>
      <circle
        cx="6"
        cy="6"
        r="4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="6 10"
        strokeLinecap="round"
      />
    </svg>
  );
}
