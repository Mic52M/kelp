"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Live-scan visualization. Streams through the scan steps with a terminal feel
 * and a sweeping scanline, communicating "something intelligent is happening in
 * real time". Loops so the landing/dashboard always feels alive.
 */
export function ScanConsole({ steps }: { steps: string[] }) {
  const [visible, setVisible] = useState(1);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timer.current = setInterval(() => {
      setVisible((n) => (n >= steps.length ? 1 : n + 1));
    }, 900);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [steps.length]);

  const done = visible >= steps.length;

  return (
    <div className="glass relative overflow-hidden rounded-2xl">
      <div className="flex items-center gap-2 border-b border-line/70 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--color-crit)]/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--color-med)]/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--color-ok)]/70" />
        <span className="ml-2 font-mono text-xs text-fog-400">kelp scan · roamly-app</span>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-aqua-400">
          <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-aqua-400" />
          {done ? "complete" : "scanning"}
        </span>
      </div>

      <div className="relative h-[19rem] px-4 py-4">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-16 animate-scanline bg-gradient-to-b from-aqua-500/10 to-transparent" />
        <ul className="space-y-2 font-mono text-[13px] leading-relaxed">
          {steps.slice(0, visible).map((step, i) => {
            const isLast = i === visible - 1 && !done;
            const flagged = step.includes("Found") || step.includes("missing");
            return (
              <li key={i} className="flex animate-rise items-start gap-2">
                <span
                  className={
                    isLast
                      ? "text-aqua-400"
                      : flagged
                        ? "text-[color:var(--color-high)]"
                        : "text-ok"
                  }
                >
                  {isLast ? "▸" : flagged ? "!" : "✓"}
                </span>
                <span className={flagged ? "text-fog-50" : "text-fog-300"}>
                  {step}
                  {isLast && <span className="ml-1 animate-pulse-soft">▍</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t border-line/70 px-4 py-3">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
          <div
            className="h-full rounded-full bg-gradient-to-r from-aqua-500 to-violet-500 transition-all duration-700"
            style={{ width: `${Math.round((visible / steps.length) * 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
