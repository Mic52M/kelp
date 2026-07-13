"use client";

// Free-scan live view + reveal (#32). Polls /api/free-scan/[id] every 1.5s,
// shows a phased checklist while running, then splits results into an
// un-redacted preview + a locked list gated by email capture.

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Reveal } from "@/components/Reveal";
import { buttonClasses } from "@/components/Button";
import { ShareRow } from "@/components/free-scan/ShareRow";

type Severity = "critical" | "high" | "medium" | "low";

interface Preview {
  vulnClass: string;
  severity: Severity;
  fingerprint: string;
  title: string;
  location: string | null;
  explanation: string;
}
interface Locked {
  vulnClass: string;
  severity: Severity;
  fingerprint: string;
  title: string;
}
interface Diagnostic {
  version: number;
  ranScanners: string[];
  notes: string[];
  backendDetected: "supabase" | "firebase" | "none";
  filesScanned: number;
  entriesSeen: number;
  capReached: boolean;
  tablesParsed: number;
  counts: Record<Severity, number>;
}

interface Snapshot {
  id: string;
  slug: string;
  repoUrl: string;
  status: "queued" | "running" | "succeeded" | "capped" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
  emailCaptured: boolean;
  totalFindings: number;
  counts: Record<Severity, number>;
  preview: Preview[];
  locked: Locked[];
  diagnostic: Diagnostic | null;
}

const PHASES = [
  "Reaching the repo",
  "Reading source files",
  "Scanning for exposed secrets",
  "Parsing schema & RLS policies",
  "Analyzing results",
];

function severityLabel(s: Severity): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function severityDot(s: Severity): string {
  switch (s) {
    case "critical":
    case "high":
      return "var(--color-signal)";
    case "medium":
      return "var(--color-paper-300)";
    case "low":
      return "var(--color-paper-500)";
  }
}

function classLabel(cls: string): string {
  switch (cls) {
    case "secret":
      return "SEC · Exposed secret";
    case "rls":
      return "RLS · Row-level security";
    case "bola":
      return "BOLA · Broken authorization";
    default:
      return cls.toUpperCase();
  }
}

export default function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [phase, setPhase] = useState(0);
  const [email, setEmail] = useState("");
  const [emailPending, setEmailPending] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  // Poll status.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick() {
      try {
        const res = await fetch(`/api/free-scan/${id}`, { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) timer = setTimeout(tick, 2500);
          return;
        }
        const j = (await res.json()) as Snapshot;
        if (cancelled) return;
        setSnap(j);
        if (j.status === "queued" || j.status === "running") {
          timer = setTimeout(tick, 1500);
        }
      } catch {
        if (!cancelled) timer = setTimeout(tick, 2500);
      }
    }
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  // Phase animation while running.
  useEffect(() => {
    if (!snap) return;
    if (snap.status !== "queued" && snap.status !== "running") return;
    const iv = setInterval(() => setPhase((p) => Math.min(p + 1, PHASES.length - 1)), 4000);
    return () => clearInterval(iv);
  }, [snap]);

  const running = snap?.status === "queued" || snap?.status === "running";
  const done = snap?.status === "succeeded" || snap?.status === "capped";
  const failed = snap?.status === "failed";

  const meta = useMemo(() => {
    if (!snap) return null;
    const d = snap.durationMs != null ? `${(snap.durationMs / 1000).toFixed(1)}s` : "—";
    const parts = [
      `${snap.totalFindings} finding${snap.totalFindings === 1 ? "" : "s"}`,
      snap.counts.critical + snap.counts.high > 0
        ? `${snap.counts.critical + snap.counts.high} serious`
        : null,
      `scanned in ${d}`,
    ].filter(Boolean);
    return parts.join(" · ");
  }, [snap]);

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setEmailError(null);
    setEmailPending(true);
    try {
      const res = await fetch(`/api/free-scan/${id}/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setEmailError(j.error === "invalid_email" ? "That email doesn't look right." : "Try again in a moment.");
        return;
      }
      // Re-fetch the snapshot; reveal will flip on.
      const s = await fetch(`/api/free-scan/${id}`, { cache: "no-store" });
      setSnap((await s.json()) as Snapshot);
    } catch {
      setEmailError("Network issue. Try again.");
    } finally {
      setEmailPending(false);
    }
  }

  return (
    <main className="relative min-h-screen">
      <header className="mx-auto flex max-w-[1120px] items-center justify-between px-6 pt-8 pb-6">
        <Link href="/" aria-label="Kelp home">
          <Logo />
        </Link>
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
          Free scan · No signup
        </div>
      </header>
      <div className="mx-auto max-w-[1120px] px-6">
        <div className="h-px w-full bg-[color:var(--color-hair)]" />
      </div>

      <section className="mx-auto max-w-[860px] px-6 pt-16 pb-24">
        <Reveal>
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-signal-dim)]">
            {snap?.repoUrl?.replace(/^https:\/\//, "") ?? "…"}
          </div>
        </Reveal>
        <Reveal delay={80}>
          <h1 className="font-display mt-6 text-[44px] leading-[1.05] text-[color:var(--color-paper-50)] sm:text-[56px]">
            {running && "Scanning…"}
            {done && "Report ready."}
            {failed && "Scan couldn't finish."}
            {!snap && "Preparing…"}
          </h1>
        </Reveal>
        {meta && done && (
          <Reveal delay={160}>
            <p className="mt-5 font-mono text-[12.5px] text-[color:var(--color-paper-400)]">{meta}</p>
          </Reveal>
        )}

        {running && (
          <div className="mt-14 border border-[color:var(--color-hair-strong)] bg-[color:var(--color-ink-900)]">
            <div className="flex items-center gap-3 border-b border-[color:var(--color-hair)] px-5 py-3">
              <span className="inline-block h-1.5 w-1.5 animate-pulse bg-[color:var(--color-signal)]" />
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
                Running · this typically takes 15–45s
              </span>
            </div>
            <ol className="divide-y divide-[color:var(--color-hair)]">
              {PHASES.map((p, i) => (
                <li
                  key={p}
                  className="grid grid-cols-[3rem_1fr] gap-4 px-5 py-3 font-mono text-[13px]"
                >
                  <span className="tabular text-[color:var(--color-paper-600)]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={
                      i < phase
                        ? "text-[color:var(--color-paper-300)]"
                        : i === phase
                          ? "text-[color:var(--color-signal)]"
                          : "text-[color:var(--color-paper-500)]"
                    }
                  >
                    {p}
                    {i === phase && <span className="ml-2 animate-pulse">·</span>}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {failed && (
          <div className="mt-14 border border-[color:var(--color-hair-strong)] px-6 py-6">
            <p className="text-[14.5px] leading-[1.65] text-[color:var(--color-paper-300)]">
              We couldn't finish the scan. {snap?.error ? `(${snap.error})` : "Try again in a moment or paste a different repo URL."}
            </p>
            <Link href="/" className={`${buttonClasses("secondary", "md", "cta-lift")} mt-6 inline-block`}>
              Back to landing
            </Link>
          </div>
        )}

        {done && snap && (
          <div className="mt-14 space-y-10">
            <ShareRow slug={snap.slug} repoUrl={snap.repoUrl} />
            <DiagnosticPanel diagnostic={snap.diagnostic} />

            {/* Un-redacted preview or full findings if email captured. */}
            <div className="divide-y divide-[color:var(--color-hair)] border-y border-[color:var(--color-hair)]">
              {snap.preview.map((f) => (
                <FindingRow key={f.fingerprint} f={f} />
              ))}
              {snap.totalFindings === 0 && (
                <div className="px-2 py-10 text-[14.5px] leading-[1.65] text-[color:var(--color-paper-300)]">
                  {snap.diagnostic?.backendDetected === "supabase"
                    ? "Kelp checked your Supabase schema and repo end-to-end for the classes we cover — no issues found. That's a real full-scope pass on this stack, not a partial audit."
                    : snap.diagnostic?.backendDetected === "firebase"
                      ? "This is a Firebase project. Kelp's Firebase adapter is on the roadmap — for now only the secret scan ran, and it came back clean."
                      : "Kelp is built for vibe-coded apps on Supabase. This repo doesn't use Supabase, so only the generic secret scan applies here — and nothing hardcoded was found."}
                </div>
              )}
            </div>

            {!snap.emailCaptured && snap.locked.length > 0 && (
              <div className="border border-[color:var(--color-hair-strong)] px-6 py-8">
                <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-signal-dim)]">
                  {snap.locked.length} more finding{snap.locked.length === 1 ? "" : "s"} · locked
                </div>
                <ul className="mt-5 space-y-2">
                  {snap.locked.map((l) => (
                    <li
                      key={l.fingerprint}
                      className="flex items-center gap-4 font-mono text-[12.5px] text-[color:var(--color-paper-400)]"
                    >
                      <span
                        aria-hidden
                        className="inline-block h-2 w-2"
                        style={{ background: severityDot(l.severity) }}
                      />
                      <span className="min-w-[80px] uppercase tracking-[0.12em] text-[color:var(--color-paper-500)]">
                        {severityLabel(l.severity)}
                      </span>
                      <span className="blur-[3px] select-none">
                        {l.title}
                      </span>
                    </li>
                  ))}
                </ul>
                <form onSubmit={submitEmail} className="mt-8 border-t border-[color:var(--color-hair)] pt-6">
                  <label className="block font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
                    Get the full report
                  </label>
                  <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={emailPending}
                      placeholder="you@company.com"
                      className="flex-1 border border-[color:var(--color-hair)] bg-transparent px-3 py-2 font-mono text-[13px] text-[color:var(--color-paper-50)] outline-none focus:border-[color:var(--color-signal)] placeholder:text-[color:var(--color-paper-500)] disabled:opacity-60"
                    />
                    <button
                      type="submit"
                      disabled={emailPending}
                      className={buttonClasses("primary", "md", "cta-lift")}
                    >
                      {emailPending ? "…" : "Reveal findings"}
                    </button>
                  </div>
                  {emailError && (
                    <p className="mt-3 font-mono text-[11.5px] text-[color:var(--color-signal)]">
                      {emailError}
                    </p>
                  )}
                  <p className="mt-4 font-mono text-[11px] leading-[1.6] text-[color:var(--color-paper-500)]">
                    One email, no password. We'll use it to send the full
                    findings and (only if you opt in) continuous scanning.
                  </p>
                </form>
              </div>
            )}

            {snap.emailCaptured && (
              <div className="border border-[color:var(--color-hair-strong)] px-6 py-8">
                <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-signal-dim)]">
                  Want continuous cover?
                </div>
                <h3 className="font-display mt-4 text-[26px] leading-[1.15] text-[color:var(--color-paper-50)]">
                  Sign up to re-scan on every push.
                </h3>
                <p className="mt-3 max-w-[52ch] text-[14.5px] leading-[1.6] text-[color:var(--color-paper-300)]">
                  Kelp will watch your repo, open fix PRs for secrets, and let
                  you actively probe broken authorization on demand.
                </p>
                <div className="mt-6 flex gap-3">
                  <Link href={`/login?email=${encodeURIComponent(email)}`} className={buttonClasses("primary", "md", "cta-lift")}>
                    Create account
                  </Link>
                  <Link href="/" className={buttonClasses("secondary", "md", "cta-lift")}>
                    Not yet
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

function DiagnosticPanel({ diagnostic }: { diagnostic: Diagnostic | null }) {
  if (!diagnostic) return null;
  const scanners = diagnostic.ranScanners.length
    ? diagnostic.ranScanners
        .map((s) => (s === "secret" ? "Secret scan" : s === "rls_from_repo" ? "RLS (from repo)" : s))
        .join(" · ")
    : "—";

  const backendLabel =
    diagnostic.backendDetected === "supabase"
      ? "Supabase detected"
      : diagnostic.backendDetected === "firebase"
        ? "Firebase detected"
        : "No Kelp-native backend detected";

  return (
    <section
      aria-label="What Kelp checked"
      className="border border-[color:var(--color-hair-strong)]"
    >
      <div className="flex items-center gap-3 border-b border-[color:var(--color-hair)] px-5 py-3">
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5"
          style={{
            background:
              diagnostic.backendDetected === "none"
                ? "var(--color-paper-500)"
                : "var(--color-signal)",
          }}
        />
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
          What Kelp checked
        </span>
      </div>
      <dl className="grid grid-cols-1 divide-y divide-[color:var(--color-hair)] font-mono text-[12.5px] text-[color:var(--color-paper-300)] sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="px-5 py-3">
          <dt className="text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">Backend</dt>
          <dd className="mt-1">{backendLabel}</dd>
        </div>
        <div className="px-5 py-3">
          <dt className="text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">Scanners run</dt>
          <dd className="mt-1">{scanners}</dd>
        </div>
        <div className="px-5 py-3">
          <dt className="text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">Files scanned</dt>
          <dd className="mt-1 tabular">
            {diagnostic.filesScanned}
            {diagnostic.entriesSeen > diagnostic.filesScanned && (
              <span className="ml-2 text-[color:var(--color-paper-500)]">
                of {diagnostic.entriesSeen} in repo
              </span>
            )}
            {diagnostic.capReached && (
              <span className="ml-2 text-[color:var(--color-signal)]">· cap reached</span>
            )}
          </dd>
        </div>
        <div className="px-5 py-3">
          <dt className="text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">Tables parsed (RLS)</dt>
          <dd className="mt-1 tabular">{diagnostic.tablesParsed}</dd>
        </div>
      </dl>
      {diagnostic.notes.length > 0 && (
        <ul className="border-t border-[color:var(--color-hair)] px-5 py-4 space-y-2">
          {diagnostic.notes.map((n, i) => (
            <li
              key={i}
              className="flex items-start gap-3 text-[13px] leading-[1.6] text-[color:var(--color-paper-300)]"
            >
              <span
                aria-hidden
                className="mt-[7px] inline-block h-px w-3 flex-shrink-0 bg-[color:var(--color-signal-dim)]"
              />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FindingRow({ f }: { f: Preview }) {
  return (
    <article className="grid grid-cols-1 gap-4 py-8 lg:grid-cols-12 lg:gap-10">
      <div className="lg:col-span-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="inline-block h-2 w-2"
            style={{ background: severityDot(f.severity) }}
          />
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
            {severityLabel(f.severity)}
          </span>
        </div>
        <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-signal-dim)]">
          {classLabel(f.vulnClass)}
        </div>
      </div>
      <div className="lg:col-span-9">
        <h3 className="font-display text-[22px] leading-[1.2] text-[color:var(--color-paper-50)]">
          {f.title}
        </h3>
        {f.location && (
          <div className="mt-2 font-mono text-[11.5px] text-[color:var(--color-paper-500)]">
            {f.location}
          </div>
        )}
        <p className="mt-3 max-w-[62ch] text-[14.5px] leading-[1.7] text-[color:var(--color-paper-300)]">
          {f.explanation}
        </p>
      </div>
    </article>
  );
}
