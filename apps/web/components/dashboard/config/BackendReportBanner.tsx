"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BackendReport } from "@kelp/core";
import { runBackendAnalyzerAction } from "@/app/dashboard/configuration/actions";
import { ChevronDownIcon, DatabaseIcon, InfoIcon } from "./icons";

const REANALYZE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Kelp's read on the connected repo, shown at the top of Configuration.
 * Two roles: (1) signal to the user that Kelp actually looked at their
 * project (transparency + confidence), (2) surface the auth-flow narrative
 * + hints that guide the rest of the setup.
 *
 * When the report is missing (older projects) we hide the banner entirely
 * rather than render an empty state — the rest of the page still works.
 */
export function BackendReportBanner({
  report,
  projectId,
}: {
  report: BackendReport | null;
  projectId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(
    null,
  );
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
      className={`rounded-2xl border ${
        confidence === "high"
          ? "border-aqua-600/25 bg-gradient-to-br from-aqua-500/[0.06] to-aqua-500/[0.02]"
          : "border-line/70 bg-ink-900/40"
      }`}
    >
      <div className="flex items-start gap-4 px-6 py-5">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
            confidence === "high" ? "bg-aqua-500/15 text-aqua-300" : "bg-ink-800/70 text-fog-300"
          }`}
        >
          <DatabaseIcon />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10.5px] font-medium uppercase tracking-[0.14em] text-fog-500">
            Kelp analyzed your project
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold tracking-tight text-fog-100">
              {backendLabel}
            </span>
            <ConfidencePill confidence={confidence} />
          </div>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-fog-300">
            {report.authFlow.narrative || report.primary.reason}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg border border-line/60 px-2.5 py-1 text-[11.5px] text-fog-400 transition-colors hover:border-line hover:text-fog-200"
          >
            {expanded ? "Hide details" : "Details"}
            <ChevronDownIcon
              className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
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
            className="inline-flex items-center gap-1 rounded-lg border border-line/60 px-2.5 py-1 text-[11.5px] text-fog-400 transition-colors hover:border-line hover:text-fog-200 disabled:cursor-not-allowed disabled:opacity-50"
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
          className={`mx-6 mt-3 rounded-lg border px-3 py-2 text-[12.5px] ${
            message.kind === "info"
              ? "border-aqua-600/30 bg-aqua-500/[0.06] text-aqua-300"
              : "border-crit/30 bg-crit/[0.06] text-crit"
          }`}
        >
          {message.text}
        </div>
      )}

      {expanded && (
        <div className="border-t border-line/50 px-6 py-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <DetailBlock label="Why Kelp thinks so" body={report.primary.reason} />
            {report.authFlow.providers.length > 0 && (
              <DetailBlock
                label="Auth providers detected"
                body={report.authFlow.providers.map(providerLabel).join(", ")}
              />
            )}
            {report.publicConfig.supabaseUrl && (
              <DetailBlock
                label="Supabase URL (public)"
                body={report.publicConfig.supabaseUrl}
                mono
              />
            )}
            {report.publicConfig.firebaseProjectId && (
              <DetailBlock
                label="Firebase project"
                body={report.publicConfig.firebaseProjectId}
                mono
              />
            )}
            {report.publicConfig.convexUrl && (
              <DetailBlock
                label="Convex deployment"
                body={report.publicConfig.convexUrl}
                mono
              />
            )}
            {report.authFlow.signupPath && (
              <DetailBlock label="Signup path" body={report.authFlow.signupPath} mono />
            )}
          </div>

          {report.hints.length > 0 && (
            <div className="mt-5">
              <div className="mb-2 text-[10.5px] font-medium uppercase tracking-[0.14em] text-fog-500">
                What we noticed
              </div>
              <ul className="space-y-1.5 text-[13px] leading-relaxed text-fog-300">
                {report.hints.map((h, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="mt-1 shrink-0 text-fog-500">
                      <InfoIcon className="h-3.5 w-3.5" />
                    </span>
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.warnings.length > 0 && (
            <div className="mt-5 rounded-xl border border-amber-500/25 bg-amber-500/[0.04] p-4">
              <div className="mb-2 text-[10.5px] font-medium uppercase tracking-[0.14em] text-amber-300">
                Worth a look
              </div>
              <ul className="space-y-1.5 text-[13px] leading-relaxed text-fog-300">
                {report.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-5 text-[10.5px] text-fog-500">
            Analyzed {formatTimeAgo(report.analyzedAt)} · Kelp only uses public
            values already in your repo — never secrets.
          </div>
        </div>
      )}
    </div>
  );
}

function ConfidencePill({ confidence }: { confidence: "high" | "medium" | "low" }) {
  const styles: Record<typeof confidence, string> = {
    high: "bg-aqua-500/15 text-aqua-300",
    medium: "bg-amber-500/15 text-amber-300",
    low: "bg-fog-500/12 text-fog-300",
  };
  const label: Record<typeof confidence, string> = {
    high: "High confidence",
    medium: "Some uncertainty",
    low: "Best guess",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${styles[confidence]}`}
    >
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
      <div className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-fog-500">
        {label}
      </div>
      <div
        className={`mt-1 break-words text-[13px] leading-relaxed text-fog-200 ${
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
