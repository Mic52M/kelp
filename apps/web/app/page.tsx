import Link from "next/link";
import { buttonClasses } from "@/components/Button";
import { Logo } from "@/components/Logo";
import { MultiAgentConsole } from "@/components/MultiAgentConsole";
import { CopyableCommand } from "@/components/CopyableCommand";

/* ── Copy ──────────────────────────────────────────────────────────────────── */

const checks = [
  { tag: "SEC-001", title: "Hardcoded secrets", body: "Provider patterns + entropy fallback across the source tree. Client-side secrets are severity-bumped." },
  { tag: "RLS-002", title: "Permissive Supabase RLS", body: "Reads schema + policies, flags tables open to anon. Fixes ship as reviewable migrations." },
  { tag: "EDGE-003", title: "Edge functions skipping JWT", body: "Detects verify_jwt=false, replays without a token, records the response." },
  { tag: "AUTH-004", title: "CORS and auth flow gaps", body: "Permissive origins, missing rate-limits on password reset, open redirects." },
];

const faqs = [
  {
    q: "Is Kelp free?",
    a: "The engine, CLI, and GitHub Action are MIT-licensed and free forever. The hosted app at kelp.build is free while it's small — a paid tier may show up later, but the code stays open.",
  },
  {
    q: "Do I need to sign up for anything?",
    a: "No. `npx @kelp-security/cli scan .` works with zero configuration. `uses: kelp-security/kelp-action@v1` runs in CI without any Kelp account. Sign in only matters for the hosted app's continuous scanning.",
  },
  {
    q: "Does Kelp catch every vulnerability?",
    a: "No. Kelp covers a small set of high-impact classes with high precision — the ones that actually breach AI-generated apps. Real fixes for those beat a forty-page report of maybes.",
  },
  {
    q: "How do I extend Kelp?",
    a: "New secret patterns go in packages/core/src/scanners/secrets.ts. New backends (Firebase, Convex) follow docs/ADAPTERS.md. Contributor walkthrough in CONTRIBUTING.md.",
  },
];

const REPO_URL = "https://github.com/Mic52M/kelp";

/* ── Page ──────────────────────────────────────────────────────────────────── */

export default function Landing() {
  return (
    <main className="relative min-h-screen">
      {/* Filament — thin left-rail signature. */}
      <div className="pointer-events-none absolute inset-y-0 left-6 hidden xl:block">
        <div className="filament" />
      </div>

      {/* ── NAV ─────────────────────────────────────────────────────────── */}
      <header className="mx-auto flex max-w-[1120px] items-center justify-between px-6 pt-8 pb-6">
        <Link href="/" aria-label="Kelp home">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-8 text-[13.5px] text-[color:var(--color-paper-300)] md:flex">
          <Link href="/docs" className="transition-colors hover:text-[color:var(--color-paper-50)]">Docs</Link>
          <a href={REPO_URL} target="_blank" rel="noreferrer noopener" className="transition-colors hover:text-[color:var(--color-paper-50)]">GitHub ↗</a>
        </nav>
        <div className="flex items-center gap-5">
          <Link
            href="/dashboard"
            className="hidden text-[13.5px] text-[color:var(--color-paper-400)] transition-colors hover:text-[color:var(--color-paper-50)] sm:inline"
          >
            Hosted app
          </Link>
          <a href={REPO_URL} target="_blank" rel="noreferrer noopener" className={buttonClasses("primary", "md", "cta-lift")}>
            Star on GitHub
          </a>
        </div>
      </header>

      <div className="mx-auto max-w-[1120px] px-6">
        <div className="h-px w-full bg-[color:var(--color-hair)]" />
      </div>

      {/* ── HERO — huge type + install command, Ollama-style ────────────── */}
      <section className="mx-auto max-w-[1120px] px-6 pt-24 pb-32 sm:pt-32">
        <div className="grid gap-16 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-7">
            <div className="eyebrow flex items-center gap-3">
              <span className="text-[color:var(--color-signal-dim)]">§ 00</span>
              <span className="h-px w-6 bg-[color:var(--color-hair-strong)]" aria-hidden />
              <span>Open source · MIT</span>
            </div>

            <h1 className="font-display mt-8 text-[60px] leading-[0.98] tracking-[-0.01em] text-[color:var(--color-paper-50)] sm:text-[80px] lg:text-[92px]">
              Security scans
              <br />
              for <span className="italic text-[color:var(--color-paper-300)]">vibe-coded</span> apps.
            </h1>

            <p className="mt-8 max-w-[520px] text-[17px] leading-[1.55] text-[color:var(--color-paper-300)]">
              Kelp finds hardcoded secrets, permissive Supabase RLS, and unauthenticated edge functions —
              the classes that actually breach AI-generated apps. Run it in one command.
            </p>

            <div className="mt-10 max-w-[520px]">
              <CopyableCommand command="npx @kelp-security/cli scan ." />
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
              <Link href="/docs/quickstart" className="hover:text-[color:var(--color-paper-100)]">Quickstart →</Link>
              <span aria-hidden>·</span>
              <Link href="/docs" className="hover:text-[color:var(--color-paper-100)]">Docs</Link>
              <span aria-hidden>·</span>
              <a href="https://github.com/kelp-security/kelp-action" target="_blank" rel="noreferrer noopener" className="hover:text-[color:var(--color-paper-100)]">GitHub Action ↗</a>
            </div>
          </div>

          <div className="lg:col-span-5">
            <MultiAgentConsole />
            <p className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
              Excerpt from an actual scan · nothing invented
            </p>
          </div>
        </div>
      </section>

      {/* ── COVERAGE — one-line-each, tight ─────────────────────────────── */}
      <section id="checks" className="border-y border-[color:var(--color-hair)] bg-[color:var(--color-ink-900)]/40">
        <div className="mx-auto max-w-[1120px] px-6 py-24">
          <div className="mb-14 max-w-xl">
            <div className="eyebrow flex items-center gap-3">
              <span className="text-[color:var(--color-signal-dim)]">§ 01</span>
              <span className="h-px w-6 bg-[color:var(--color-hair-strong)]" aria-hidden />
              <span>Coverage</span>
            </div>
            <h2 className="font-display mt-6 text-[36px] leading-[1.05] text-[color:var(--color-paper-50)] sm:text-[44px]">
              Small on purpose.
              <br />
              <span className="text-[color:var(--color-paper-300)]">Every finding reproduces.</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2">
            {checks.map((c) => (
              <div key={c.tag}>
                <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-signal-dim)]">
                  {c.tag}
                </div>
                <h3 className="font-display mt-3 text-[22px] leading-[1.2] text-[color:var(--color-paper-50)]">
                  {c.title}
                </h3>
                <p className="mt-3 max-w-[46ch] text-[14.5px] leading-[1.6] text-[color:var(--color-paper-300)]">
                  {c.body}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-14 border-t border-[color:var(--color-hair)] pt-6">
            <Link
              href="/docs"
              className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-400)] transition-colors hover:text-[color:var(--color-paper-100)]"
            >
              Full coverage in the docs →
            </Link>
          </div>
        </div>
      </section>

      {/* ── THREE WAYS TO RUN — install commands per surface ────────────── */}
      <section className="mx-auto max-w-[1120px] px-6 py-28">
        <div className="mb-14 max-w-xl">
          <div className="eyebrow flex items-center gap-3">
            <span className="text-[color:var(--color-signal-dim)]">§ 02</span>
            <span className="h-px w-6 bg-[color:var(--color-hair-strong)]" aria-hidden />
            <span>Run it</span>
          </div>
          <h2 className="font-display mt-6 text-[36px] leading-[1.05] text-[color:var(--color-paper-50)] sm:text-[44px]">
            Three surfaces.
            <br />
            <span className="text-[color:var(--color-paper-300)]">Same engine.</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* CLI */}
          <div className="border border-[color:var(--color-hair)] p-6 transition-colors hover:border-[color:var(--color-hair-strong)]">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-signal-dim)]">
              01 · CLI
            </div>
            <h3 className="font-display mt-3 text-[22px] leading-[1.2] text-[color:var(--color-paper-50)]">
              Local scans.
            </h3>
            <p className="mt-2 text-[13.5px] leading-[1.55] text-[color:var(--color-paper-300)]">
              One command, no signup, no keys. Same engine everywhere else.
            </p>
            <div className="mt-5 border border-[color:var(--color-hair)] bg-[color:var(--color-ink-900)]/60 px-4 py-3">
              <code className="font-mono text-[12.5px] text-[color:var(--color-paper-100)]">
                <span className="text-[color:var(--color-signal-dim)]">$ </span>
                npx @kelp-security/cli scan .
              </code>
            </div>
            <Link
              href="/docs/quickstart"
              className="mt-5 inline-block font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-400)] hover:text-[color:var(--color-paper-100)]"
            >
              Quickstart →
            </Link>
          </div>

          {/* Action */}
          <div className="border border-[color:var(--color-hair)] p-6 transition-colors hover:border-[color:var(--color-hair-strong)]">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-signal-dim)]">
              02 · GitHub Action
            </div>
            <h3 className="font-display mt-3 text-[22px] leading-[1.2] text-[color:var(--color-paper-50)]">
              Gate every PR.
            </h3>
            <p className="mt-2 text-[13.5px] leading-[1.55] text-[color:var(--color-paper-300)]">
              Fails the check when a PR introduces new critical or high findings.
            </p>
            <div className="mt-5 border border-[color:var(--color-hair)] bg-[color:var(--color-ink-900)]/60 px-4 py-3">
              <code className="font-mono text-[12.5px] leading-relaxed text-[color:var(--color-paper-100)]">
                <span className="text-[color:var(--color-signal-dim)]">-&nbsp;</span>uses: kelp-security/
                <br />
                &nbsp;&nbsp;&nbsp;kelp-action@v1
              </code>
            </div>
            <Link
              href="/docs/action"
              className="mt-5 inline-block font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-400)] hover:text-[color:var(--color-paper-100)]"
            >
              Action docs →
            </Link>
          </div>

          {/* Hosted */}
          <div className="border border-[color:var(--color-hair)] p-6 transition-colors hover:border-[color:var(--color-hair-strong)]">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-signal-dim)]">
              03 · Hosted app
            </div>
            <h3 className="font-display mt-3 text-[22px] leading-[1.2] text-[color:var(--color-paper-50)]">
              Continuous scan.
            </h3>
            <p className="mt-2 text-[13.5px] leading-[1.55] text-[color:var(--color-paper-300)]">
              Connect a repo once. Dashboards, history, chat per finding, fix PRs.
            </p>
            <div className="mt-5 border border-[color:var(--color-hair)] bg-[color:var(--color-ink-900)]/60 px-4 py-3">
              <code className="font-mono text-[12.5px] text-[color:var(--color-paper-100)]">
                <span className="text-[color:var(--color-signal-dim)]"># </span>
                sign in with GitHub
              </code>
            </div>
            <Link
              href="/dashboard"
              className="mt-5 inline-block font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-400)] hover:text-[color:var(--color-paper-100)]"
            >
              Open hosted app →
            </Link>
          </div>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────────── */}
      <section className="border-y border-[color:var(--color-hair)] bg-[color:var(--color-ink-900)]/40">
        <div className="mx-auto max-w-[1120px] px-6 py-24">
          <div className="mb-14 max-w-xl">
            <div className="eyebrow flex items-center gap-3">
              <span className="text-[color:var(--color-signal-dim)]">§ 03</span>
              <span className="h-px w-6 bg-[color:var(--color-hair-strong)]" aria-hidden />
              <span>Questions</span>
            </div>
            <h2 className="font-display mt-6 text-[36px] leading-[1.05] text-[color:var(--color-paper-50)] sm:text-[44px]">
              What people ask first.
            </h2>
          </div>

          <div className="divide-y divide-[color:var(--color-hair)] border-y border-[color:var(--color-hair)]">
            {faqs.map((f, i) => (
              <div key={f.q} className="grid grid-cols-1 gap-6 py-8 lg:grid-cols-12 lg:gap-10">
                <div className="lg:col-span-1">
                  <div className="font-mono tabular text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
                    {String(i + 1).padStart(2, "0")}
                  </div>
                </div>
                <div className="lg:col-span-11">
                  <h3 className="font-display text-[20px] leading-[1.2] text-[color:var(--color-paper-50)]">
                    {f.q}
                  </h3>
                  <p className="mt-3 max-w-[68ch] text-[14.5px] leading-[1.65] text-[color:var(--color-paper-300)]">
                    {f.a}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CLOSING CTA ─────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1120px] px-6 py-28">
        <div className="border border-[color:var(--color-hair-strong)] px-8 py-14 text-center sm:px-14 sm:py-20">
          <h2 className="font-display mx-auto max-w-[16ch] text-[40px] leading-[1.05] text-[color:var(--color-paper-50)] sm:text-[56px]">
            Scan your app before your users do.
          </h2>
          <div className="mx-auto mt-10 max-w-[520px]">
            <CopyableCommand command="npx @kelp-security/cli scan ." />
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-6 font-mono text-[11.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
            <a href={REPO_URL} target="_blank" rel="noreferrer noopener" className="hover:text-[color:var(--color-paper-100)]">Star on GitHub ↗</a>
            <span aria-hidden>·</span>
            <Link href="/docs" className="hover:text-[color:var(--color-paper-100)]">Read the docs</Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-[color:var(--color-hair)]">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
            © {new Date().getFullYear()} Kelp · MIT · built by{" "}
            <a
              href="https://github.com/Mic52M"
              target="_blank"
              rel="noreferrer noopener"
              className="hover:text-[color:var(--color-paper-50)]"
            >
              @Mic52M
            </a>
          </div>
          <nav className="flex flex-wrap items-center gap-6 text-[12.5px] text-[color:var(--color-paper-400)]">
            <a href={REPO_URL} target="_blank" rel="noreferrer noopener" className="hover:text-[color:var(--color-paper-50)]">GitHub</a>
            <Link href="/docs" className="hover:text-[color:var(--color-paper-50)]">Docs</Link>
            <a href={`${REPO_URL}/blob/master/SECURITY.md`} target="_blank" rel="noreferrer noopener" className="hover:text-[color:var(--color-paper-50)]">Security</a>
            <Link href="/dashboard" className="hover:text-[color:var(--color-paper-50)]">Hosted app</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
