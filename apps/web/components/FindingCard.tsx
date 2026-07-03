"use client";

import { useActionState, useState } from "react";
import type { Finding } from "@/lib/types";
import { SeverityBadge } from "./SeverityBadge";
import { dismissFinding, openFixPr, type FixPrState } from "@/app/dashboard/finding-actions";

const CLASS_LABEL: Record<Finding["vulnClass"], string> = {
  rls: "Row Level Security",
  secret: "Exposed secret",
  bola: "Object-level authorization",
};

const STATUS: Record<Finding["status"], { label: string; className: string }> = {
  open: { label: "Needs fix", className: "text-fog-300 border-line" },
  pr_opened: { label: "PR opened", className: "text-aqua-400 border-aqua-600/40" },
  needs_review: { label: "In review", className: "text-violet-400 border-violet-500/40" },
  confirmed: { label: "Confirmed", className: "text-[color:var(--color-high)] border-line" },
  resolved: { label: "Resolved", className: "text-ok border-aqua-600/40" },
};

export function FindingCard({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState(finding.severity === "critical" && finding.status === "open");
  const [copied, setCopied] = useState(false);
  const [fixPr, fixPrAction, fixPrPending] = useActionState<FixPrState, FormData>(openFixPr, {});

  const prUrl = finding.prUrl ?? fixPr.url;
  const canOpenPr = finding.autofixable && finding.status === "open" && !prUrl;

  const copyPrompt = async () => {
    if (!finding.fixPrompt) return;
    try {
      await navigator.clipboard.writeText(finding.fixPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };
  const status = STATUS[finding.status];

  return (
    <div className="glass overflow-hidden rounded-xl">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.02]"
      >
        <SeverityBadge severity={finding.severity} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium">{finding.title}</div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-fog-400">
            <span>{CLASS_LABEL[finding.vulnClass]}</span>
            <span className="text-line">·</span>
            <span className="truncate font-mono">{finding.location}</span>
          </div>
        </div>
        <span className={`hidden shrink-0 rounded-full border px-2.5 py-0.5 text-xs sm:inline ${status.className}`}>
          {status.label}
        </span>
        <span className={`shrink-0 text-fog-400 transition-transform ${open ? "rotate-90" : ""}`}>
          ›
        </span>
      </button>

      {open && (
        <div className="animate-rise border-t border-line/70 px-4 py-4">
          <p className="text-sm leading-relaxed text-fog-300">{finding.explanation}</p>

          {finding.exposure && (
            <div className="mt-3 flex flex-wrap gap-2">
              {finding.exposure.map((e) => (
                <span
                  key={e.category}
                  className="rounded-md border border-[color:var(--color-crit)]/30 bg-[color:var(--color-crit)]/10 px-2.5 py-1 text-xs text-[color:var(--color-crit)]"
                >
                  {e.count.toLocaleString()} {e.category} records exposed
                </span>
              ))}
            </div>
          )}

          <div className="mt-4 rounded-lg border border-line/70 bg-ink-900/60 p-3">
            <div className="mb-1.5 text-xs font-medium text-fog-400">What to do</div>
            <p className="text-sm text-fog-300">{finding.remediation}</p>
          </div>

          {finding.fixPreview && (
            <pre className="mt-3 overflow-x-auto rounded-lg border border-line/70 bg-ink-950 p-3 font-mono text-[12.5px] leading-relaxed text-fog-300">
              {finding.fixPreview}
            </pre>
          )}

          {finding.fixPrompt && (
            <div className="mt-3 rounded-lg border border-violet-500/30 bg-violet-500/[0.06] p-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-violet-400">
                  Or fix it with your AI tool
                </span>
                <button
                  onClick={copyPrompt}
                  className="rounded-md border border-violet-500/40 bg-ink-800 px-2.5 py-1 text-xs font-medium text-fog-50 transition-colors hover:bg-ink-700"
                >
                  {copied ? "Copied ✓" : "Copy prompt"}
                </button>
              </div>
              <p className="text-[13px] leading-relaxed text-fog-300">{finding.fixPrompt}</p>
              <div className="mt-2 text-[11px] text-fog-500">
                Paste into Lovable, Bolt, Cursor or v0 to apply the fix.
              </div>
            </div>
          )}

          {finding.status !== "resolved" && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {finding.vulnClass === "bola" && (
                <span className="rounded-lg border border-violet-500/40 bg-violet-500/[0.08] px-3.5 py-2 text-sm text-violet-300">
                  Queued for Kelp review
                </span>
              )}
              {canOpenPr && (
                <form action={fixPrAction}>
                  <input type="hidden" name="findingId" value={finding.id} />
                  <button
                    type="submit"
                    disabled={fixPrPending}
                    className="rounded-lg bg-fog-50 px-3.5 py-2 text-sm font-medium text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {fixPrPending ? "Opening PR…" : "Open fix PR"}
                  </button>
                </form>
              )}
              {prUrl && (
                <a
                  href={prUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-aqua-600/40 bg-aqua-500/[0.08] px-3.5 py-2 text-sm font-medium text-aqua-400 transition-colors hover:bg-aqua-500/[0.14]"
                >
                  View PR on GitHub ↗
                </a>
              )}
              <form action={dismissFinding}>
                <input type="hidden" name="findingId" value={finding.id} />
                <button
                  type="submit"
                  className="rounded-lg border border-line bg-ink-800 px-3.5 py-2 text-sm font-medium text-fog-50 transition-colors hover:bg-ink-700"
                >
                  Dismiss
                </button>
              </form>
            </div>
          )}

          {fixPr.error && !prUrl && (
            <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[13px] leading-relaxed text-amber-300/90">
              {fixPr.error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
