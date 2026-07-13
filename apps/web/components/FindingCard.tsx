"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { Finding, Severity } from "@/lib/types";
import { classMeta, ClassIcon } from "./findings/vuln-class";
import { EvidencePanel } from "./findings/EvidencePanel";
import { track } from "./PostHogProvider";
import { Button, buttonClasses } from "./Button";
import { SeverityBadge } from "./SeverityBadge";
import {
  markResolvedFinding,
  reportFalsePositive,
  openFixPr,
  type FixPrState,
} from "@/app/dashboard/finding-actions";

const SEV_COLOR: Record<Severity, string> = {
  critical: "var(--color-sev-crit)",
  high: "var(--color-sev-high)",
  medium: "var(--color-sev-med)",
  low: "var(--color-sev-low)",
};

const STATUS: Record<Finding["status"], { label: string; color: string }> = {
  open:         { label: "Needs fix",         color: "var(--color-paper-300)" },
  pr_opened:    { label: "PR opened",         color: "var(--color-signal)" },
  needs_review: { label: "Needs your review", color: "var(--color-sev-med)" },
  confirmed:    { label: "Confirmed",         color: "var(--color-sev-high)" },
  resolved:     { label: "Resolved",          color: "var(--color-signal-dim)" },
};

export function FindingCard({
  finding,
  defaultOpen,
}: {
  finding: Finding;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(
    defaultOpen ?? (finding.severity === "critical" && finding.status === "open"),
  );
  const [viewedFired, setViewedFired] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fixPr, fixPrAction, fixPrPending] = useActionState<FixPrState, FormData>(openFixPr, {});

  const prUrl = finding.prUrl ?? fixPr.url;
  const canOpenPr = finding.autofixable && finding.status === "open" && !prUrl;
  const cls = classMeta(finding.vulnClass);
  const status = STATUS[finding.status];
  const sevColor = SEV_COLOR[finding.severity];

  const copyPrompt = async () => {
    if (!finding.fixPrompt) return;
    try {
      await navigator.clipboard.writeText(finding.fixPrompt);
      setCopied(true);
      track("finding.fix_prompt_copied", {
        findingId: finding.id,
        vulnClass: finding.vulnClass,
        severity: finding.severity,
      });
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div
      className="relative border border-[color:var(--color-hair)] bg-transparent transition-colors hover:border-[color:var(--color-hair-strong)]"
      style={{ borderLeft: `2px solid ${sevColor}` }}
    >
      <button
        onClick={() => {
          setOpen((v) => !v);
          // finding.viewed (#34): fire once per session per card, and only
          // on OPEN (not on collapse). defaultOpen findings still count —
          // the user actually saw them expanded on mount.
          if (!viewedFired && !open) {
            track("finding.viewed", {
              findingId: finding.id,
              vulnClass: finding.vulnClass,
              severity: finding.severity,
              status: finding.status,
            });
            setViewedFired(true);
          }
        }}
        className="flex w-full items-start gap-5 px-6 py-5 text-left"
      >
        <span className="mt-1 text-[color:var(--color-paper-400)]">
          <ClassIcon vc={finding.vulnClass} className="h-[18px] w-[18px]" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <SeverityBadge severity={finding.severity} />
            <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
              {cls.label}
            </span>
            <span
              className="font-mono text-[10.5px] uppercase tracking-[0.16em]"
              style={{ color: status.color }}
            >
              · {status.label}
            </span>
          </div>
          <div className="font-display mt-3 text-[19px] leading-[1.3] text-[color:var(--color-paper-50)]">
            {finding.title}
          </div>
          {finding.location && (
            <div className="mt-2 truncate font-mono text-[12px] text-[color:var(--color-paper-400)]">
              {finding.location}
            </div>
          )}
        </div>

        <ChevronIcon
          className={`mt-1 h-4 w-4 shrink-0 text-[color:var(--color-paper-500)] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="animate-rise border-t border-[color:var(--color-hair)] px-6 py-6">
          <p className="max-w-[68ch] text-[14px] leading-[1.7] text-[color:var(--color-paper-300)]">
            {finding.explanation}
          </p>

          {finding.triage && <TriageBanner finding={finding} />}

          <EvidencePanel finding={finding} />

          {finding.exposure && finding.exposure.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {finding.exposure.map((e) => (
                <span
                  key={e.category}
                  className="border px-3 py-1 font-mono text-[11.5px]"
                  style={{
                    borderColor: "var(--color-sev-crit)",
                    color: "var(--color-sev-crit)",
                  }}
                >
                  {e.count.toLocaleString()} {e.category} records exposed
                </span>
              ))}
            </div>
          )}

          {finding.remediation && (
            <div className="mt-6 border-l border-[color:var(--color-hair-strong)] pl-5">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
                What to do
              </div>
              <p className="mt-2 max-w-[68ch] text-[13.5px] leading-[1.7] text-[color:var(--color-paper-300)]">
                {finding.remediation}
              </p>
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
            <div className="mt-7 flex flex-wrap items-center gap-3">
              {finding.vulnClass === "bola" && (
                <span
                  className="border px-3.5 py-2 font-mono text-[11.5px] uppercase tracking-[0.14em]"
                  style={{
                    borderColor: "var(--color-hair-strong)",
                    color: "var(--color-paper-300)",
                  }}
                >
                  Queued · Kelp review
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
                  className={buttonClasses("secondary", "md")}
                  style={{ color: "var(--color-signal)", borderColor: "var(--color-signal-dim)" }}
                >
                  View PR on GitHub ↗
                </a>
              )}
              <form action={markResolvedFinding}>
                <input type="hidden" name="findingId" value={finding.id} />
                <MarkResolvedButton />
              </form>
              <form action={reportFalsePositive}>
                <input type="hidden" name="findingId" value={finding.id} />
                <FalsePositiveButton />
              </form>
            </div>
          )}

          {fixPr.error && !prUrl && (
            <p
              className="mt-4 border px-4 py-2.5 font-mono text-[12px] leading-relaxed"
              style={{
                borderColor: "var(--color-sev-high)",
                color: "var(--color-sev-high)",
              }}
            >
              {fixPr.error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

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
    <div className="mt-5 border-l border-[color:var(--color-paper-400)] pl-5">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-400)]">
        Kelp reviewed this
      </div>
      {reclass.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2 font-mono text-[11.5px] text-[color:var(--color-paper-300)]">
          {reclass.map((r) => (
            <span key={r}>· {r}</span>
          ))}
        </div>
      )}
      {t.reason && (
        <p className="mt-2 max-w-[68ch] text-[13px] leading-[1.7] text-[color:var(--color-paper-300)]">
          {t.reason}
        </p>
      )}
    </div>
  );
}

function MarkResolvedButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? "Marking…" : "Mark resolved"}
    </Button>
  );
}

function FalsePositiveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="tertiary" disabled={pending} title="Not a real issue — removes it from your list">
      {pending ? "Removing…" : "False positive"}
    </Button>
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
    <div className="mt-6 border border-[color:var(--color-hair-strong)]">
      <div className="flex items-center justify-between border-b border-[color:var(--color-hair)] px-4 py-2.5">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-400)]">
          Fix it with your AI tool
        </div>
        <button
          onClick={onCopy}
          className="inline-flex items-center gap-1.5 border border-[color:var(--color-hair-strong)] px-2.5 py-1 font-mono text-[11px] text-[color:var(--color-paper-100)] transition-colors hover:border-[color:var(--color-paper-400)]"
        >
          {copied ? (
            <>
              <CheckIcon className="h-3 w-3" style={{ color: "var(--color-signal)" }} />
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
        <p className="whitespace-pre-wrap font-mono text-[12px] leading-[1.75] text-[color:var(--color-paper-100)]">
          {body}
        </p>
        <div className="mt-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
          Paste into your AI coding tool.
        </div>
      </div>
    </div>
  );
}

function CodeBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-6 border border-[color:var(--color-hair-strong)]">
      <div className="border-b border-[color:var(--color-hair)] px-4 py-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
        {title}
      </div>
      <pre className="overflow-x-auto bg-[color:var(--color-ink-1000)] px-4 py-3 font-mono text-[12px] leading-[1.75] text-[color:var(--color-paper-100)]">
        {body}
      </pre>
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
function CopyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="7" y="7" width="9" height="9" rx="1.5" />
      <path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" />
    </svg>
  );
}
function CheckIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden>
      <path d="m4.5 10.5 3.5 3.5L15.5 6" />
    </svg>
  );
}
