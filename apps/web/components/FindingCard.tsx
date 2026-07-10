"use client";

import { useActionState, useState } from "react";
import type { Finding, Severity } from "@/lib/types";
import { classMeta, ClassIcon } from "./findings/vuln-class";
import { Button } from "./Button";
import {
  markResolvedFinding,
  reportFalsePositive,
  openFixPr,
  type FixPrState,
} from "@/app/dashboard/finding-actions";

// Severity drives the card's left accent + chip. One source of truth.
const SEV: Record<
  Severity,
  { label: string; color: string; soft: string; rank: number }
> = {
  critical: { label: "Critical", color: "var(--color-crit)", soft: "rgba(255,92,106,0.12)", rank: 0 },
  high: { label: "High", color: "var(--color-high)", soft: "rgba(255,159,69,0.12)", rank: 1 },
  medium: { label: "Medium", color: "var(--color-med)", soft: "rgba(255,212,92,0.12)", rank: 2 },
  low: { label: "Low", color: "var(--color-low)", soft: "rgba(98,182,255,0.12)", rank: 3 },
};

const STATUS: Record<Finding["status"], { label: string; className: string }> = {
  open: { label: "Needs fix", className: "text-fog-300 border-line" },
  pr_opened: { label: "PR opened", className: "text-aqua-400 border-aqua-600/40" },
  needs_review: { label: "Needs your review", className: "text-violet-300 border-violet-500/40" },
  confirmed: { label: "Confirmed", className: "text-[color:var(--color-high)] border-line" },
  resolved: { label: "Resolved", className: "text-aqua-300 border-aqua-600/40" },
};

export function FindingCard({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState(
    finding.severity === "critical" && finding.status === "open",
  );
  const [copied, setCopied] = useState(false);
  const [fixPr, fixPrAction, fixPrPending] = useActionState<FixPrState, FormData>(openFixPr, {});

  const prUrl = finding.prUrl ?? fixPr.url;
  const canOpenPr = finding.autofixable && finding.status === "open" && !prUrl;
  const sev = SEV[finding.severity];
  const cls = classMeta(finding.vulnClass);
  const status = STATUS[finding.status];

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

  return (
    <div
      className="group relative overflow-hidden rounded-2xl border border-line/70 bg-ink-900/40 transition-colors hover:border-line"
      style={{ borderLeft: `2px solid ${sev.color}` }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-white/[0.015]"
      >
        {/* Class icon in a severity-tinted tile */}
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: sev.soft, color: sev.color }}
        >
          <ClassIcon vc={finding.vulnClass} className="h-[18px] w-[18px]" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={{ backgroundColor: sev.soft, color: sev.color }}
            >
              {sev.label}
            </span>
            <span className="truncate text-[15px] font-medium text-fog-50">{finding.title}</span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[12px] text-fog-400">
            <span>{cls.label}</span>
            {finding.location && (
              <>
                <span className="text-line">·</span>
                <span className="truncate font-mono text-[11.5px]">{finding.location}</span>
              </>
            )}
          </div>
        </div>

        <span
          className={`hidden shrink-0 rounded-full border px-2.5 py-0.5 text-[11.5px] sm:inline ${status.className}`}
        >
          {status.label}
        </span>
        <ChevronIcon
          className={`h-4 w-4 shrink-0 text-fog-500 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="animate-rise border-t border-line/60 px-5 py-5">
          <p className="text-[13.5px] leading-relaxed text-fog-300">{finding.explanation}</p>

          {finding.triage && <TriageBanner finding={finding} />}

          {finding.exposure && finding.exposure.length > 0 && (
            <div className="mt-3.5 flex flex-wrap gap-2">
              {finding.exposure.map((e) => (
                <span
                  key={e.category}
                  className="rounded-md border border-[color:var(--color-crit)]/30 bg-[color:var(--color-crit)]/10 px-2.5 py-1 text-[12px] text-[color:var(--color-crit)]"
                >
                  {e.count.toLocaleString()} {e.category} records exposed
                </span>
              ))}
            </div>
          )}

          {finding.remediation && (
            <div className="mt-4 rounded-xl border border-line/60 bg-ink-950/50 p-4">
              <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-[0.14em] text-fog-500">
                What to do
              </div>
              <p className="text-[13px] leading-relaxed text-fog-300">{finding.remediation}</p>
            </div>
          )}

          {finding.fixPreview && (
            <CodeBlock title="Proposed change" body={finding.fixPreview} />
          )}

          {finding.fixPrompt && (
            <FixPromptBlock
              body={finding.fixPrompt}
              copied={copied}
              onCopy={copyPrompt}
            />
          )}

          {finding.status !== "resolved" && (
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {finding.vulnClass === "bola" && (
                <span className="rounded-lg border border-violet-500/40 bg-violet-500/[0.08] px-3.5 py-2 text-sm text-violet-300">
                  Queued for Kelp review
                </span>
              )}
              {canOpenPr && (
                <form action={fixPrAction}>
                  <input type="hidden" name="findingId" value={finding.id} />
                  <Button type="submit" disabled={fixPrPending}>
                    {fixPrPending ? "Opening PR…" : "Open fix PR"}
                  </Button>
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
              <form action={markResolvedFinding}>
                <input type="hidden" name="findingId" value={finding.id} />
                <Button type="submit" variant="secondary">
                  Mark resolved
                </Button>
              </form>
              <form action={reportFalsePositive}>
                <input type="hidden" name="findingId" value={finding.id} />
                <button
                  type="submit"
                  title="Not a real issue — removes it from your list"
                  className="rounded-lg border border-line px-3.5 py-2 text-sm text-fog-400 transition-colors hover:border-fog-600 hover:text-fog-200"
                >
                  False positive
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

/** Violet "Kelp reviewed this" banner — shown when triage reclassified or
 *  downgraded the finding. Builds trust: the user sees Kelp's own second look. */
function TriageBanner({ finding }: { finding: Finding }) {
  const t = finding.triage!;
  const reclass =
    t.originalVulnClass || t.originalSeverity
      ? [
          t.originalSeverity && t.originalSeverity !== finding.severity
            ? `severity ${t.originalSeverity} → ${finding.severity}`
            : null,
          t.originalVulnClass && t.originalVulnClass !== finding.vulnClass
            ? `class ${classMeta(t.originalVulnClass).short} → ${classMeta(finding.vulnClass).short}`
            : null,
        ].filter(Boolean)
      : [];
  return (
    <div className="mt-3.5 rounded-xl border border-violet-500/25 bg-violet-500/[0.05] p-4">
      <div className="flex items-center gap-2">
        <span className="text-violet-300">
          <ScaleIcon className="h-4 w-4" />
        </span>
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-violet-300">
          Kelp reviewed this
        </span>
      </div>
      {reclass.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {reclass.map((r) => (
            <span
              key={r}
              className="rounded-md bg-violet-500/12 px-2 py-0.5 text-[11px] font-medium text-violet-200"
            >
              {r}
            </span>
          ))}
        </div>
      )}
      {t.reason && (
        <p className="mt-2 text-[12.5px] leading-relaxed text-fog-300">{t.reason}</p>
      )}
    </div>
  );
}

function FixPromptBlock({
  body,
  copied,
  onCopy,
}: {
  body: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-violet-500/25 bg-violet-500/[0.04]">
      <div className="flex items-center justify-between border-b border-violet-500/15 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-violet-300">
            <SparkIcon className="h-3.5 w-3.5" />
          </span>
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-violet-300">
            Fix it with your AI tool
          </span>
        </div>
        <button
          onClick={onCopy}
          className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/40 bg-ink-900/60 px-2.5 py-1 text-[11.5px] font-medium text-fog-100 transition-colors hover:bg-ink-800"
        >
          {copied ? (
            <>
              <CheckIcon className="h-3 w-3 text-aqua-300" />
              Copied
            </>
          ) : (
            <>
              <CopyIcon className="h-3.5 w-3.5" />
              Copy prompt
            </>
          )}
        </button>
      </div>
      <div className="px-4 py-3">
        <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-fog-200">{body}</p>
        <div className="mt-2.5 text-[10.5px] text-fog-500">
          Paste into Lovable, Bolt, Cursor, or v0 to apply the fix.
        </div>
      </div>
    </div>
  );
}

function CodeBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-line/60">
      <div className="border-b border-line/50 bg-ink-950/60 px-4 py-2 text-[10.5px] font-medium uppercase tracking-[0.14em] text-fog-500">
        {title}
      </div>
      <pre className="overflow-x-auto bg-ink-950 px-4 py-3 font-mono text-[12px] leading-relaxed text-fog-300">
        {body}
      </pre>
    </div>
  );
}

// ─── Icons ──────────────────────────────────────────────────────────────────

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="m6 8 4 4 4-4" />
    </svg>
  );
}
function CopyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="7" y="7" width="9" height="9" rx="1.5" />
      <path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" />
    </svg>
  );
}
function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="m4.5 10.5 3.5 3.5L15.5 6" />
    </svg>
  );
}
function SparkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M10 2.5 11.5 8 17 9.5 11.5 11 10 16.5 8.5 11 3 9.5 8.5 8 10 2.5Z" />
    </svg>
  );
}
function ScaleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M10 3v14M6 6l-3 5a3 3 0 0 0 6 0L6 6ZM14 6l-3 5a3 3 0 0 0 6 0l-3-5ZM5 17h10" />
    </svg>
  );
}
