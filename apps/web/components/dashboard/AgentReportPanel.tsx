"use client";

// "How the pen test ran" panel — shows per-agent evidence of what the
// autonomous squad actually did on the most recent active_pentest scan.
// Purpose: turn a "0 findings" result from "did anything happen?" into "here's
// exactly what the agents tried, and why they concluded it was clean".

import { useState } from "react";
import type { PersistedAgentReport } from "@/lib/data";

const AGENT_LABEL: Record<string, string> = {
  "agent-data": "Data agent",
  "agent-edge": "Edge agent",
  "agent-surface": "Surface agent",
};

const AGENT_SUB: Record<string, string> = {
  "agent-data": "PostgREST · RLS · cross-account reads",
  "agent-edge": "Function authz · injection · SSRF",
  "agent-surface": "CORS · secrets · auth config · enumeration",
};

function isFollowup(name: string): boolean {
  return name.startsWith("followup:");
}

function money(usd: number): string {
  if (usd < 0.01) return "< $0.01";
  return `$${usd.toFixed(2)}`;
}

export function AgentReportPanel({ report }: { report: PersistedAgentReport }) {
  const total = report.totalUsage;
  const tokens = total.inputTokens + total.outputTokens;
  return (
    <section className="mt-16">
      <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-fog-500">
        How the pen test ran
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">Agent report</h2>
        <div className="flex items-center gap-2 text-[12.5px] text-fog-400">
          <Metric>{report.outcomes.length} agents</Metric>
          <span className="text-line">·</span>
          <Metric>{money(total.estimatedCostUsd)}</Metric>
          <span className="text-line">·</span>
          <Metric>{tokens.toLocaleString()} tokens</Metric>
        </div>
      </div>
      <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-fog-400">
        Each agent reasons over its own attack surface, probes real endpoints, and
        loops. Open one to see its exact steps — evidence the scan did the work.
      </p>
      <div className="mt-6 space-y-3">
        {report.outcomes.map((o) => (
          <AgentRow key={o.name} o={o} />
        ))}
      </div>
    </section>
  );
}

function Metric({ children }: { children: React.ReactNode }) {
  return <span className="tabular-nums">{children}</span>;
}

function AgentRow({ o }: { o: PersistedAgentReport["outcomes"][number] }) {
  const [open, setOpen] = useState(false);
  const followup = isFollowup(o.name);
  const label = followup
    ? `Follow-up · ${o.name.replace(/^followup:/, "")}`
    : AGENT_LABEL[o.name] ?? o.name;
  const sub = followup ? "Reviewer-spawned lead" : AGENT_SUB[o.name] ?? "";
  const cost = o.usage?.estimatedCostUsd ?? 0;
  const tokens = o.usage ? o.usage.inputTokens + o.usage.outputTokens : 0;

  const state: "error" | "found" | "clean" = o.error
    ? "error"
    : o.findingsCount > 0
      ? "found"
      : "clean";

  return (
    <div className="overflow-hidden rounded-2xl border border-line/70 bg-ink-900/40 transition-colors hover:border-line">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-white/[0.015]"
      >
        <StatusDot state={state} count={o.findingsCount} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-medium text-fog-50">{label}</span>
            {followup && (
              <span className="rounded-full border border-violet-500/40 bg-violet-500/[0.08] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-violet-300">
                reviewer
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-fog-400">
            {sub && (
              <>
                <span className="truncate">{sub}</span>
                <span className="text-line">·</span>
              </>
            )}
            <span>{o.steps} steps</span>
            <span className="text-line">·</span>
            <span className="tabular-nums">
              {tokens.toLocaleString()} tokens · {money(cost)}
            </span>
          </div>
        </div>
        <ChevronIcon
          className={`h-4 w-4 shrink-0 text-fog-500 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="animate-rise border-t border-line/60 px-5 py-5 text-sm text-fog-300">
          {o.error && (
            <p className="mb-4 rounded-lg border border-crit/30 bg-crit/[0.06] px-3 py-2 text-[13px] text-crit">
              {o.error}
            </p>
          )}
          {o.transcript.length === 0 ? (
            <p className="text-fog-500">The agent finished without narrating any steps.</p>
          ) : (
            <ol className="relative space-y-0 border-l border-line/50 pl-5">
              {o.transcript.map((step, i) => (
                <li key={i} className="relative pb-4 last:pb-0">
                  <span className="absolute -left-[23px] top-1 flex h-3 w-3 items-center justify-center rounded-full border border-line bg-ink-900">
                    <span className="h-1 w-1 rounded-full bg-fog-500" />
                  </span>
                  <div className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-fog-500">
                    Step {i + 1}
                  </div>
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-fog-200">
                    {step}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function StatusDot({ state, count }: { state: "error" | "found" | "clean"; count: number }) {
  const styles = {
    error: "border-crit/50 text-crit",
    found: "border-[color:var(--color-high)]/50 text-[color:var(--color-high)]",
    clean: "border-aqua-600/40 text-aqua-400",
  }[state];
  return (
    <span
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium ${styles}`}
    >
      {state === "error" ? "!" : state === "found" ? count : "✓"}
    </span>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="m6 8 4 4 4-4" />
    </svg>
  );
}
