"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BackendReport } from "@kelp/core";
import { runBackendAnalyzerAction } from "@/app/dashboard/configuration/actions";
import { ChevronDownIcon, DatabaseIcon, InfoIcon } from "./icons";

const REANALYZE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function BackendReportBanner({
  report,
  projectId,
}: {
  report: BackendReport | null;
  projectId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  if (!report) return null;

  const backendLabel = TYPE_LABEL[report.primary.type];
  const confidence = report.primary.confidence;
  const analyzedMs = new Date(report.analyzedAt).getTime();
  const cooldownRemainingMs = Math.max(0, analyzedMs + REANALYZE_COOLDOWN_MS - Date.now());
  const canReanalyze = cooldownRemainingMs === 0;

  const onReanalyze = () => {
    setMessage(null);
    startTransition(async () => {
      const res = await runBackendAnalyzerAction(projectId, "manual");
      if (res.ok) {
        setMessage({ kind: "info", text: "Re-analysis complete." });
        router.refresh();
      } else {
        setMessage({ kind: "error", text: res.message });
      }
    });
  };

  return (
    <div
      className="border"
      style={{
        borderColor:
          confidence === "high" ? "var(--color-signal-dim)" : "var(--color-hair)",
      }}
    >
      <div className="flex items-start gap-5 px-6 py-5">
        <div
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border"
          style={{
            borderColor:
              confidence === "high" ? "var(--color-signal-dim)" : "var(--color-hair-strong)",
            color:
              confidence === "high" ? "var(--color-signal)" : "var(--color-paper-300)",
          }}
        >
          <DatabaseIcon />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
            § Kelp analyzed your project
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-3">
            <span className="font-display text-[22px] leading-[1.15] text-[color:var(--color-paper-50)]">
              {backendLabel}
            </span>
            <ConfidencePill confidence={confidence} />
          </div>
          <p className="mt-3 text-[13.5px] leading-[1.65] text-[color:var(--color-paper-300)]">
            {report.authFlow.narrative || report.primary.reason}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1.5 border border-[color:var(--color-hair-strong)] px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-400)] transition-colors hover:border-[color:var(--color-paper-400)] hover:text-[color:var(--color-paper-50)]"
          >
            {expanded ? "Hide" : "Details"}
            <ChevronDownIcon
              className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </button>
          <button
            type="button"
            onClick={onReanalyze}
            disabled={pending || !canReanalyze}
            title={
              canReanalyze
                ? "Re-run Kelp's analyzer on the current repo state"
                : `Available again in ${formatCooldown(cooldownRemainingMs)}`
            }
            className="inline-flex items-center gap-1 border border-[color:var(--color-hair-strong)] px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-400)] transition-colors hover:border-[color:var(--color-paper-400)] hover:text-[color:var(--color-paper-50)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending
              ? "Analyzing…"
              : canReanalyze
                ? "Re-analyze"
                : `Re-analyze in ${formatCooldown(cooldownRemainingMs)}`}
          </button>
        </div>
      </div>

      {message && (
        <div
          className="mx-6 mt-3 border-l px-4 py-2 font-mono text-[12px] leading-relaxed"
          style={{
            borderColor:
              message.kind === "info" ? "var(--color-signal)" : "var(--color-sev-crit)",
            color:
              message.kind === "info" ? "var(--color-signal)" : "var(--color-sev-crit)",
          }}
        >
          {message.text}
        </div>
      )}

      {expanded && (
        <div className="border-t border-[color:var(--color-hair)] px-6 py-6">
          <div className="grid gap-6 sm:grid-cols-2">
            <DetailBlock label="Why Kelp thinks so" body={report.primary.reason} />
            {report.authFlow.providers.length > 0 && (
              <DetailBlock
                label="Auth providers detected"
                body={report.authFlow.providers.map(providerLabel).join(", ")}
              />
            )}
            {report.publicConfig.supabaseUrl && (
              <DetailBlock label="Supabase URL (public)" body={report.publicConfig.supabaseUrl} mono />
            )}
            {report.publicConfig.firebaseProjectId && (
              <DetailBlock label="Firebase project" body={report.publicConfig.firebaseProjectId} mono />
            )}
            {report.publicConfig.convexUrl && (
              <DetailBlock label="Convex deployment" body={report.publicConfig.convexUrl} mono />
            )}
            {report.authFlow.signupPath && (
              <DetailBlock label="Signup path" body={report.authFlow.signupPath} mono />
            )}
          </div>

          {report.hints.length > 0 && (
            <div className="mt-6">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
                § What we noticed
              </div>
              <ul className="mt-3 space-y-2 text-[13px] leading-[1.7] text-[color:var(--color-paper-300)]">
                {report.hints.map((h, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="mt-1 shrink-0 text-[color:var(--color-paper-500)]">
                      <InfoIcon className="h-3.5 w-3.5" />
                    </span>
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.warnings.length > 0 && (
            <div
              className="mt-6 border-l pl-5"
              style={{ borderColor: "var(--color-sev-med)" }}
            >
              <div
                className="font-mono text-[10.5px] uppercase tracking-[0.16em]"
                style={{ color: "var(--color-sev-med)" }}
              >
                § Worth a look
              </div>
              <ul className="mt-3 space-y-2 text-[13px] leading-[1.7] text-[color:var(--color-paper-300)]">
                {report.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-6 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
            Analyzed {formatTimeAgo(report.analyzedAt)} · public values only
          </div>
        </div>
      )}
    </div>
  );
}

function ConfidencePill({ confidence }: { confidence: "high" | "medium" | "low" }) {
  const color: Record<typeof confidence, string> = {
    high: "var(--color-signal)",
    medium: "var(--color-sev-med)",
    low: "var(--color-paper-400)",
  };
  const label: Record<typeof confidence, string> = {
    high: "High confidence",
    medium: "Some uncertainty",
    low: "Best guess",
  };
  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em]"
      style={{ color: color[confidence] }}
    >
      <span
        className="inline-block"
        style={{ width: 2, height: 8, background: color[confidence] }}
        aria-hidden
      />
      {label[confidence]}
    </span>
  );
}

function DetailBlock({
  label,
  body,
  mono,
}: {
  label: string;
  body: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
        {label}
      </div>
      <div
        className={`mt-2 break-words text-[13px] leading-[1.65] text-[color:var(--color-paper-100)] ${
          mono ? "font-mono text-[12.5px]" : ""
        }`}
      >
        {body}
      </div>
    </div>
  );
}

function formatTimeAgo(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const s = Math.max(0, Math.round((now - then) / 1000));
    if (s < 60) return "seconds ago";
    const m = Math.round(s / 60);
    if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
    const d = Math.round(h / 24);
    return `${d} day${d === 1 ? "" : "s"} ago`;
  } catch {
    return "recently";
  }
}

function formatCooldown(ms: number): string {
  const h = Math.floor(ms / (60 * 60 * 1000));
  if (h >= 1) return `${h}h`;
  const m = Math.max(1, Math.round(ms / (60 * 1000)));
  return `${m}m`;
}

const TYPE_LABEL: Record<BackendReport["primary"]["type"], string> = {
  supabase: "Supabase backend",
  firebase: "Firebase backend",
  convex: "Convex backend",
  "custom-api": "Custom API backend",
  unknown: "Unrecognized backend",
};

function providerLabel(p: string): string {
  const map: Record<string, string> = {
    email: "Email + password",
    google: "Google",
    github: "GitHub",
    apple: "Apple",
    magic_link: "Magic link",
    phone: "Phone (SMS)",
    facebook: "Facebook",
    twitter: "Twitter/X",
  };
  return map[p] ?? p;
}
