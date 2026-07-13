// Public shareable report: /r/<slug> (#33).
//
// SSR from `free_scans` by slug. Findings are REDACTED (title + class +
// severity). No location, no explanation, no fix content — that stays behind
// the email/signup gate on /scan/[id]. Anyone with the un-guessable slug can
// read this; robots/social crawlers included (this is the point).

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFreeScanBySlug, type FreeScanDiagnostic } from "@kelp/worker";
import { track } from "@/lib/analytics";
import { Logo } from "@/components/Logo";
import { buttonClasses } from "@/components/Button";
import { ShareRow } from "@/components/free-scan/ShareRow";

type Severity = "critical" | "high" | "medium" | "low";

interface RedactedFinding {
  vulnClass: string;
  severity: Severity;
  fingerprint: string;
  title: string;
}

const SEV_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function severityDot(s: Severity): string {
  return s === "critical" || s === "high"
    ? "var(--color-signal)"
    : s === "medium"
      ? "var(--color-paper-300)"
      : "var(--color-paper-500)";
}

function severityLabel(s: Severity): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function classLabel(cls: string): string {
  if (cls === "secret") return "SEC · Exposed secret";
  if (cls === "rls") return "RLS · Row-level security";
  if (cls === "bola") return "BOLA · Broken authorization";
  return cls.toUpperCase();
}

function coerceFindings(raw: unknown[]): RedactedFinding[] {
  return raw.filter((x): x is RedactedFinding =>
    !!x && typeof x === "object" && "vulnClass" in x && "severity" in x && "title" in x,
  );
}

function shortRepo(repoUrl: string): string {
  return repoUrl.replace(/^https:\/\/github\.com\//, "");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const row = await getFreeScanBySlug(slug);
  if (!row) return { title: "Kelp — report not found" };
  const findings = coerceFindings(row.findings);
  const counts = findings.reduce(
    (acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] ?? 0) + 1 }),
    {} as Record<Severity, number>,
  );
  const serious = (counts.critical ?? 0) + (counts.high ?? 0);
  const title = `Kelp report · ${shortRepo(row.repoUrl)} · ${findings.length} finding${findings.length === 1 ? "" : "s"}`;
  const description = serious
    ? `${serious} serious issue${serious === 1 ? "" : "s"} found on ${shortRepo(row.repoUrl)}. Scanned by Kelp.`
    : `Scanned by Kelp — ${findings.length} finding${findings.length === 1 ? "" : "s"}.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `/r/${slug}`,
      type: "article",
    },
    twitter: { card: "summary_large_image", title, description },
    robots: { index: true, follow: true },
  };
}

export default async function ShareableReport({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!/^[a-z0-9]{6,20}$/.test(slug)) notFound();

  const row = await getFreeScanBySlug(slug);
  if (!row) notFound();

  // Product analytics (#34): fires on every SSR render — the page has no
  // client-side revalidation, so this is the only signal we get that a
  // shared link was actually opened. distinctId is the slug so the view
  // lands under the same Person timeline as the original submission.
  track(slug, "free_scan.viewed_from_share", { slug });

  const findings = coerceFindings(row.findings);
  findings.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity]++;

  const diagnostic = row.diagnostic as FreeScanDiagnostic | null;
  const duration = row.durationMs != null ? `${(row.durationMs / 1000).toFixed(1)}s` : "—";
  const dateIso = row.createdAt instanceof Date
    ? row.createdAt.toISOString().slice(0, 10)
    : String(row.createdAt).slice(0, 10);

  const metaLine = [
    `${findings.length} finding${findings.length === 1 ? "" : "s"}`,
    counts.critical > 0 ? `${counts.critical} critical` : null,
    counts.high > 0 ? `${counts.high} high` : null,
    counts.medium > 0 ? `${counts.medium} medium` : null,
    counts.low > 0 ? `${counts.low} low` : null,
    `scanned in ${duration}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <main className="relative min-h-screen">
      <header className="mx-auto flex max-w-[1120px] items-center justify-between px-6 pt-8 pb-6">
        <Link href="/" aria-label="Kelp home">
          <Logo />
        </Link>
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
          KELP · Security report · {dateIso}
        </div>
      </header>
      <div className="mx-auto max-w-[1120px] px-6">
        <div className="h-px w-full bg-[color:var(--color-hair)]" />
      </div>

      <section className="mx-auto max-w-[860px] px-6 pt-16 pb-10">
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-signal-dim)]">
          {shortRepo(row.repoUrl)}
        </div>
        <h1 className="font-display mt-6 text-[44px] leading-[1.05] text-[color:var(--color-paper-50)] sm:text-[56px]">
          {findings.length === 0
            ? "No findings in Kelp's coverage."
            : `${findings.length} finding${findings.length === 1 ? "" : "s"} in this repo.`}
        </h1>
        <p className="mt-5 font-mono text-[12.5px] text-[color:var(--color-paper-400)]">{metaLine}</p>
        {diagnostic && (
          <p className="mt-3 font-mono text-[11.5px] text-[color:var(--color-paper-500)]">
            {diagnostic.backendDetected === "supabase"
              ? "Supabase backend detected"
              : diagnostic.backendDetected === "firebase"
                ? "Firebase backend detected"
                : "No Kelp-native backend detected"}
            {" · "}
            {diagnostic.filesScanned} files scanned
            {diagnostic.entriesSeen > diagnostic.filesScanned && ` of ${diagnostic.entriesSeen}`}
          </p>
        )}
      </section>

      {findings.length > 0 && (
        <section className="mx-auto max-w-[860px] px-6 pb-16">
          <div className="divide-y divide-[color:var(--color-hair)] border-y border-[color:var(--color-hair)]">
            {findings.map((f) => (
              <article
                key={f.fingerprint}
                className="grid grid-cols-1 gap-4 py-6 lg:grid-cols-12 lg:gap-10"
              >
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
                  <h3 className="font-display text-[20px] leading-[1.2] text-[color:var(--color-paper-50)]">
                    {f.title}
                  </h3>
                  <p className="mt-2 font-mono text-[11px] text-[color:var(--color-paper-500)]">
                    Details redacted — scan your own project for the full report.
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="mx-auto max-w-[860px] px-6 pb-16">
        <ShareRow slug={slug} repoUrl={row.repoUrl} />
      </section>

      <section className="mx-auto max-w-[860px] px-6 pb-24">
        <div className="border border-[color:var(--color-hair-strong)] px-6 py-10 sm:px-10 sm:py-12">
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-signal-dim)]">
            Want the full report on your own repo?
          </div>
          <h2 className="font-display mt-4 text-[30px] leading-[1.1] text-[color:var(--color-paper-50)] sm:text-[36px]">
            60 seconds. No signup.
          </h2>
          <p className="mt-4 max-w-[52ch] text-[14.5px] leading-[1.6] text-[color:var(--color-paper-300)]">
            Kelp is the security agent for vibe-coded apps. Paste your repo URL,
            watch it probe, get the fix.
          </p>
          <div className="mt-6">
            <Link href="/" className={buttonClasses("primary", "lg", "cta-lift")}>
              Scan my repo
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-[color:var(--color-hair)]">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-4 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Logo />
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
              kelp.dev
            </span>
          </div>
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
            Report {slug} · {dateIso}
          </div>
        </div>
      </footer>
    </main>
  );
}
