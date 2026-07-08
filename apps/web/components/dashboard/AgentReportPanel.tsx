"use client";

// "How the pen test ran" panel — shows per-agent evidence of what the
// autonomous squad actually did on the most recent active_pentest scan.
// Purpose: turn a "0 findings" result from "did anything happen?" into "here's
// exactly what the three agents tried, and why they concluded it was clean".

import { useState } from "react";
import type { PersistedAgentReport } from "@/lib/data";

const AGENT_LABEL: Record<string, string> = {
  "agent-data": "Data agent — PostgREST, RLS, cross-account reads",
  "agent-edge": "Edge agent — function authz, injection, SSRF",
  "agent-surface": "Surface agent — CORS, secrets, auth config, enumeration",
};

function money(usd: number): string {
  if (usd < 0.01) return `< $0.01`;
  return `$${usd.toFixed(2)}`;
}

export function AgentReportPanel({ report }: { report: PersistedAgentReport }) {
  const total = report.totalUsage;
  return (
    <section className="mt-14">
      <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-fog-500">
        How the pen test ran
      </div>
      <div className="flex items-baseline justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">Agent report</h2>
        <span className="text-sm text-fog-400">
          {report.outcomes.length} agents · {money(total.estimatedCostUsd)} ·{" "}
          {(total.inputTokens + total.outputTokens).toLocaleString()} tokens
        </span>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-fog-400">
        Each agent reasons over its own attack surface, probes real endpoints, and
        loops. Click one to see its exact steps — evidence that the scan did the
        work, and where its reasoning went.
      </p>
      <div className="mt-6 space-y-3">
        {report.outcomes.map((o) => (
          <AgentRow key={o.name} o={o} />
        ))}
      </div>
    </section>
  );
}

function AgentRow({ o }: { o: PersistedAgentReport["outcomes"][number] }) {
  const [open, setOpen] = useState(false);
  const label = AGENT_LABEL[o.name] ?? o.name;
  const cost = o.usage?.estimatedCostUsd ?? 0;
  const tokens = o.usage ? o.usage.inputTokens + o.usage.outputTokens : 0;
  return (
    <div className="glass overflow-hidden rounded-xl">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.02]"
      >
        <span
          className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${
            o.error
              ? "border border-crit/50 text-crit"
              : o.findingsCount > 0
                ? "border border-[color:var(--color-high)]/50 text-[color:var(--color-high)]"
                : "border border-aqua-600/40 text-aqua-400"
          }`}
        >
          {o.error ? "!" : o.findingsCount > 0 ? o.findingsCount : "✓"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium">{label}</div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-fog-400">
            <span>{o.steps} reasoning steps</span>
            <span className="text-line">·</span>
            <span>{o.findingsCount} finding{o.findingsCount === 1 ? "" : "s"}</span>
            <span className="text-line">·</span>
            <span>{tokens.toLocaleString()} tokens · {money(cost)}</span>
          </div>
        </div>
        <span className={`shrink-0 text-fog-400 transition-transform ${open ? "rotate-90" : ""}`}>›</span>
      </button>
      {open && (
        <div className="animate-rise border-t border-line/70 px-4 py-4 text-sm text-fog-300">
          {o.error && (
            <p className="mb-4 rounded-lg border border-crit/30 bg-crit/[0.06] px-3 py-2 text-[13px] text-crit">
              {o.error}
            </p>
          )}
          {o.transcript.length === 0 ? (
            <p className="text-fog-500">The agent finished without narrating any steps.</p>
          ) : (
            <ol className="space-y-3">
              {o.transcript.map((step, i) => (
                <li key={i} className="rounded-lg border border-line/60 bg-ink-900/40 px-3 py-2">
                  <div className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-fog-500">
                    Step {i + 1}
                  </div>
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-fog-200">{step}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
