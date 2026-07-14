"use client";

// Hero terminal (landing page). Simulates Kelp's multi-agent pentest engine:
// several specialists (postgrest / edge-fn / auth / secrets) probing in parallel,
// interleaving observations, then a reviewer synthesizing the final report.
// The "sense of multi-agent" is what a static list can't convey — the interleave
// itself is the message.
//
// Design notes:
//   - One console, interleaved lines. Two parallel columns would look busier
//     but read less like a real agent trace.
//   - Typewriter effect per character, ~10–14ms/char. Fast enough not to bore,
//     slow enough that the reader can catch the finding.
//   - Loops on completion — landing traffic dwells for seconds, not minutes;
//     the loop is what makes returning visits feel alive too.
//   - Reduced-motion users get the final state statically, no animation.
//
// Data source: hand-crafted script mirroring an actual roamly-app scan
// transcript (see packages/core/src/agent/*). Realism matters — a fake-looking
// trace would undercut the pitch.

import { useEffect, useRef, useState } from "react";

type AgentTag = "postgrest" | "edge-fn" | "auth" | "secrets" | "reviewer";

interface Step {
  ts: string;
  agent: AgentTag;
  text: string;
  /** true when the line ends a finding (renders in agent-severity colour). */
  finding?: boolean;
}

const SCRIPT: Step[] = [
  { ts: "13:04:12", agent: "postgrest", text: "probing rls on public schema…" },
  { ts: "13:04:12", agent: "edge-fn",   text: "listing functions… found 6" },
  { ts: "13:04:13", agent: "auth",      text: "reading supabase config.toml" },
  { ts: "13:04:13", agent: "secrets",   text: "walking src/… 214 files" },
  { ts: "13:04:14", agent: "postgrest", text: "profiles.email — READ open to anon", finding: true },
  { ts: "13:04:14", agent: "edge-fn",   text: "get-order verify_jwt=false", finding: true },
  { ts: "13:04:15", agent: "secrets",   text: "VITE_SERVICE_ROLE at src/lib/db.ts:14", finding: true },
  { ts: "13:04:15", agent: "auth",      text: "reset flow missing rate-limit" },
  { ts: "13:04:16", agent: "postgrest", text: "invoices.* no policy, table exposed", finding: true },
  { ts: "13:04:16", agent: "reviewer",  text: "merging 5 leads → confirmed 4, dropped 1 unreproducible" },
  { ts: "13:04:18", agent: "reviewer",  text: "report ready · 4 findings · 2 auto-fixable · 00:06.2", finding: true },
];

const AGENT_COLOR: Record<AgentTag, string> = {
  postgrest: "var(--color-sev-med)",
  "edge-fn": "var(--color-signal)",
  auth:      "var(--color-sev-high)",
  secrets:   "var(--color-sev-crit)",
  reviewer:  "var(--color-paper-50)",
};

const CHAR_MS = 12;         // typing speed
const LINE_PAUSE_MS = 180;  // pause between lines
const LOOP_PAUSE_MS = 3600; // hold on completion, then restart

export function MultiAgentConsole() {
  // Skip animation for users who prefer reduced motion — render the whole
  // script statically. Also skip when SSR (no window) so hydration matches.
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // For animated mode: cumulative lines shown, and how many chars typed of the
  // current-in-progress line. `visible.length - 1` is the index of the line
  // being typed; earlier lines are complete.
  const [visible, setVisible] = useState<{ step: Step; chars: number }[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (reduced) return;

    let stepIndex = 0;
    let charIndex = 0;
    let cancelled = false;

    const startLine = () => {
      if (cancelled) return;
      const step = SCRIPT[stepIndex];
      if (!step) {
        // End of script: hold, then loop.
        timer.current = setTimeout(() => {
          if (cancelled) return;
          stepIndex = 0;
          charIndex = 0;
          setVisible([]);
          startLine();
        }, LOOP_PAUSE_MS);
        return;
      }
      setVisible((prev) => [...prev, { step, chars: 0 }]);
      tick();
    };

    const tick = () => {
      if (cancelled) return;
      const step = SCRIPT[stepIndex];
      if (!step) return;
      charIndex++;
      if (charIndex <= step.text.length) {
        setVisible((prev) => {
          const copy = prev.slice();
          copy[copy.length - 1] = { step, chars: charIndex };
          return copy;
        });
        timer.current = setTimeout(tick, CHAR_MS);
      } else {
        // Line complete → pause, then start next.
        stepIndex++;
        charIndex = 0;
        timer.current = setTimeout(startLine, LINE_PAUSE_MS);
      }
    };

    startLine();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [reduced]);

  const shown = reduced
    ? SCRIPT.map((step) => ({ step, chars: step.text.length }))
    : visible;
  const totalLines = SCRIPT.length;
  const activeAgents = new Set<AgentTag>(shown.map((v) => v.step.agent));
  const agentCount = Math.max(activeAgents.size, 1);

  return (
    <div className="relative overflow-hidden border border-[color:var(--color-hair-strong)] bg-[color:var(--color-ink-900)]">
      <div className="flex items-center justify-between border-b border-[color:var(--color-hair)] px-4 py-2.5">
        <div className="eyebrow flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 animate-pulse-soft bg-[color:var(--color-signal)]" />
          <span>scan/roamly-app</span>
        </div>
        <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
          {agentCount} {agentCount === 1 ? "specialist" : "specialists"} · streaming
        </div>
      </div>
      <div
        className="font-mono text-[12.5px] leading-[1.75]"
        // Reserve height so the terminal doesn't grow during the animation.
        // 11 lines × ~26px + header buffer.
        style={{ minHeight: `${totalLines * 30}px` }}
      >
        {shown.map(({ step, chars }, i) => {
          const isTyping = !reduced && i === shown.length - 1 && chars < step.text.length;
          const isFinal = step.finding;
          const color = AGENT_COLOR[step.agent];
          const text = step.text.slice(0, chars);
          return (
            <div
              key={i}
              className="grid grid-cols-[3.4rem_5.5rem_1fr] gap-3 border-b border-[color:var(--color-hair)] px-4 py-1.5 last:border-b-0"
            >
              <span className="tabular text-[color:var(--color-paper-600)]">{step.ts}</span>
              <span
                className="tabular"
                style={{ color, opacity: isFinal ? 1 : 0.85 }}
              >
                [{step.agent}]
              </span>
              <span
                className={isFinal ? "font-medium" : ""}
                style={{
                  color: isFinal ? color : "var(--color-paper-100)",
                }}
              >
                {text}
                {isTyping && <span className="caret-blink" aria-hidden />}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
