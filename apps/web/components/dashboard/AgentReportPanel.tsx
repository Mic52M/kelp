"use client";

// "How the pen test ran" panel — editorial anchor, per-agent evidence.

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
      <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
        § How the pen test ran
      </div>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-4">
        <h2 className="font-display text-[28px] leading-[1.15] text-[color:var(--color-paper-50)]">
          Agent report
        </h2>
        <div className="flex items-center gap-3 font-mono text-[11.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-400)]">
          <span className="tabular">{report.outcomes.length} agents</span>
          <span className="text-[color:var(--color-paper-600)]">·</span>
          <span className="tabular">{money(total.estimatedCostUsd)}</span>
          <span className="text-[color:var(--color-paper-600)]">·</span>
          <span className="tabular">{tokens.toLocaleString()} tokens</span>
        </div>
      </div>
      <p className="mt-3 max-w-2xl text-[13.5px] leading-[1.65] text-[color:var(--color-paper-400)]">
        Each agent reasons over its own attack surface, probes real endpoints, and loops. Open one
        to see its exact steps — evidence the scan did the work.
      </p>
      <div className="mt-8 divide-y divide-[color:var(--color-hair)] border-y border-[color:var(--color-hair)]">
        {report.outcomes.map((o) => (
          <AgentRow key={o.name} o={o} />
        ))}
      </div>
    </section>
  );
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

  const color =
    state === "error"
      ? "var(--color-sev-crit)"
      : state === "found"
        ? "var(--color-sev-high)"
        : "var(--color-signal)";

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-5 py-5 text-left transition-colors"
      >
        <span
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center border font-mono text-[11px] tabular"
          style={{ borderColor: color, color }}
          aria-hidden
        >
          {state === "error" ? "!" : state === "found" ? o.findingsCount : "✓"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="font-display text-[18px] leading-[1.2] text-[color:var(--color-paper-50)]">
              {label}
            </span>
            {followup && (
              <span
                className="font-mono text-[10px] uppercase tracking-[0.16em]"
                style={{ color: "var(--color-paper-400)" }}
              >
                Reviewer
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11.5px] text-[color:var(--color-paper-400)]">
            {sub && (
              <>
                <span>{sub}</span>
                <span className="text-[color:var(--color-paper-600)]">·</span>
              </>
            )}
            <span>{o.steps} steps</span>
            <span className="text-[color:var(--color-paper-600)]">·</span>
            <span className="tabular">
              {tokens.toLocaleString()} tokens · {money(cost)}
            </span>
          </div>
        </div>
        <ChevronIcon
          className={`mt-2 h-3.5 w-3.5 shrink-0 text-[color:var(--color-paper-500)] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="animate-rise pb-6">
          {o.error && (
            <p
              className="mb-4 border-l px-4 py-2.5 font-mono text-[12px] leading-relaxed"
              style={{ borderColor: "var(--color-sev-crit)", color: "var(--color-sev-crit)" }}
            >
              {o.error}
            </p>
          )}
          {o.transcript.length === 0 ? (
            <p className="font-mono text-[12px] text-[color:var(--color-paper-500)]">
              The agent finished without narrating any steps.
            </p>
          ) : (
            <ol className="relative space-y-0 border-l border-[color:var(--color-hair-strong)] pl-6">
              {o.transcript.map((step, i) => (
                <li key={i} className="relative pb-5 last:pb-0">
                  <span
                    className="absolute -left-[3px] top-1.5 inline-block h-1 w-1"
                    style={{ background: "var(--color-signal-dim)" }}
                  />
                  <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
                    Step {String(i + 1).padStart(2, "0")}
                  </div>
                  <p className="whitespace-pre-wrap text-[13px] leading-[1.7] text-[color:var(--color-paper-100)]">
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

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="m6 8 4 4 4-4" />
    </svg>
  );
}
