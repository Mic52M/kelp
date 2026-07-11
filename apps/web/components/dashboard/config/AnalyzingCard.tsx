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
    <section
      className="border p-6"
      style={{ borderColor: "var(--color-signal-dim)" }}
    >
      <div className="flex items-start gap-5">
        <div
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border"
          style={{ borderColor: "var(--color-signal-dim)", color: "var(--color-signal)" }}
        >
          <DatabaseIcon />
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="font-mono text-[10.5px] uppercase tracking-[0.16em]"
            style={{ color: "var(--color-signal)" }}
          >
            § Analyzing your project
          </div>
          <h2 className="font-display mt-3 text-[22px] leading-[1.15] text-[color:var(--color-paper-50)]">
            {error ? "Analysis paused" : "Kelp is looking at your repo"}
          </h2>
          <p className="mt-3 max-w-xl text-[13.5px] leading-[1.65] text-[color:var(--color-paper-300)]">
            {error
              ? "You can still finish setup manually below. Kelp will retry on your next visit."
              : "This takes a few seconds — we're identifying your backend, extracting the public config it committed, and mapping the auth flow."}
          </p>
        </div>
      </div>

      <ol className="mt-8 space-y-3">
        {STEPS.map((s, i) => {
          const state =
            i < stepIndex
              ? "done"
              : i === stepIndex && !error
                ? "active"
                : "idle";
          return (
            <li key={s} className="flex items-center gap-4 font-mono text-[12.5px]">
              <span
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center border"
                style={{
                  borderColor:
                    state === "done"
                      ? "var(--color-signal)"
                      : state === "active"
                        ? "var(--color-signal-dim)"
                        : "var(--color-hair)",
                  color:
                    state === "done"
                      ? "var(--color-signal)"
                      : state === "active"
                        ? "var(--color-signal)"
                        : "var(--color-paper-500)",
                }}
              >
                {state === "done" ? (
                  <CheckIcon className="h-3 w-3" />
                ) : state === "active" ? (
                  <Spinner />
                ) : (
                  <span
                    className="inline-block h-1 w-1"
                    style={{ background: "var(--color-paper-600)" }}
                  />
                )}
              </span>
              <span
                style={{
                  color:
                    state === "done"
                      ? "var(--color-paper-300)"
                      : state === "active"
                        ? "var(--color-paper-50)"
                        : "var(--color-paper-500)",
                }}
              >
                {s}
              </span>
            </li>
          );
        })}
      </ol>

      {error && (
        <p
          className="mt-6 border-l px-4 py-2.5 font-mono text-[12px] leading-relaxed"
          style={{
            borderColor: "var(--color-sev-crit)",
            color: "var(--color-sev-crit)",
          }}
        >
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
