import Link from "next/link";
import { buttonClasses } from "@/components/Button";
import { Logo } from "@/components/Logo";
import { Reveal } from "@/components/Reveal";
import { FreeScanInput } from "@/components/free-scan/FreeScanInput";
import { MultiAgentConsole } from "@/components/MultiAgentConsole";
import { ArchitectureCenterpiece } from "@/components/ArchitectureCenterpiece";

/* ── Copy ──────────────────────────────────────────────────────────────────── */

const checks = [
  {
    tag: "SEC-001",
    title: "Hardcoded secrets in source.",
    body:
      "Service-role keys, Stripe secrets, and OpenAI tokens committed to the repo — including those bundled to the client. Kelp finds them with provider patterns plus entropy fallback, and never persists the raw value: only a masked preview reaches your report.",
  },
  {
    tag: "RLS-002",
    title: "Row-Level Security, checked policy-by-policy.",
    body:
      "Kelp reads your Supabase schema and finds the tables and columns anyone can read or write. The reviewer re-runs the check before it lands — if it doesn't reproduce, it doesn't ship.",
  },
  {
    tag: "EDGE-003",
    title: "Edge functions that skip the JWT.",
    body:
      "verify_jwt=false in supabase/config.toml, unauthenticated replays, permissive CORS. Every finding comes with the exact curl the executor ran and the response it got.",
  },
];

const surfaces = [
  {
    n: "01",
    t: "CLI — for local + CI shells",
    d: "One command, no signup, no keys. Uses the same @kelp/core scanners as everything else.",
    code: "npx kelp scan ./my-app",
  },
  {
    n: "02",
    t: "GitHub Action — for pull-request gating",
    d: "Fails the check when a PR introduces new critical or high findings against the base branch. Auto-comments the verdict, updated in place on each commit.",
    code: "uses: kelp-security/kelp-action@v1",
  },
  {
    n: "03",
    t: "Hosted app — for continuous scanning",
    d: "Connect a repo once, get scans on every push, dashboards, agent chat per finding, and one-click fix PRs. Optional — the CLI and Action need nothing.",
    code: "kelp.build",
  },
];

const faqs = [
  {
    q: "Is Kelp actually free?",
    a: "The engine, CLI, and GitHub Action are MIT-licensed and free to use forever — for any purpose, including commercial. The hosted app at kelp.build runs on infrastructure that costs money, so it may add a paid tier for high-usage workflows later, but the code itself stays open.",
  },
  {
    q: "Do I need to sign up for anything?",
    a: "No. `npx kelp scan ./my-app` works with zero configuration. `uses: kelp-security/kelp-action@v1` runs in CI without any Kelp-side account. Signup only matters if you want the hosted app's continuous scanning + history.",
  },
  {
    q: "Does Kelp change my code without asking?",
    a: "Never. Fixes are opened as PRs against a fresh kelp/… branch, never pushed to your default branch. Database fixes are proposed as migrations you review and run yourself. The CLI never touches your code at all — it only reads.",
  },
  {
    q: "Does Kelp claim to find every vulnerability?",
    a: "No. Kelp covers a small set of high-impact classes (secrets, RLS, edge-function auth, CORS) with high precision — the ones that actually breach AI-generated apps. Real fixes for those beats a forty-page report of maybes. See docs/SECURITY-MODEL.md for what's explicitly out of scope.",
  },
  {
    q: "How do I extend Kelp — new secret pattern, new backend?",
    a: "Open a PR against packages/core/src/scanners/ for a new pattern, or read docs/ADAPTERS.md for adding a whole new backend (Firebase, Convex, etc.). CONTRIBUTING.md has the full walkthrough.",
  },
];

/* ── Small primitives, inlined ─────────────────────────────────────────────── */

function Eyebrow({ n, children }: { n?: string; children: React.ReactNode }) {
  return (
    <div className="eyebrow flex items-center gap-3">
      {n && <span className="text-[color:var(--color-signal-dim)]">{n}</span>}
      <span className="h-px w-6 bg-[color:var(--color-hair-strong)]" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

function SectionHead({
  eyebrow,
  eyebrowIndex,
  title,
  kicker,
}: {
  eyebrow: string;
  eyebrowIndex: string;
  title: string;
  kicker?: string;
}) {
  return (
    <div className="max-w-3xl">
      <Reveal>
        <Eyebrow n={eyebrowIndex}>{eyebrow}</Eyebrow>
      </Reveal>
      <Reveal delay={80}>
        <h2 className="font-display mt-6 text-[40px] leading-[1.05] text-[color:var(--color-paper-50)] sm:text-[48px]">
          {title}
        </h2>
      </Reveal>
      {kicker && (
        <Reveal delay={160}>
          <p className="mt-5 max-w-2xl text-[15.5px] leading-[1.65] text-[color:var(--color-paper-300)]">
            {kicker}
          </p>
        </Reveal>
      )}
    </div>
  );
}

function CodeSnippet({ children }: { children: string }) {
  return (
    <div className="mt-5 border border-[color:var(--color-hair)] bg-[color:var(--color-ink-900)]/60 px-4 py-3">
      <code className="font-mono text-[12.5px] text-[color:var(--color-paper-100)]">
        <span className="text-[color:var(--color-signal-dim)]">$ </span>
        {children}
      </code>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────────── */

const REPO_URL = "https://github.com/Mic52M/kelp";
const DOCS_URL = "https://github.com/Mic52M/kelp/tree/master/docs";
const ACTION_URL = "https://github.com/kelp-security/kelp-action";

export default function Landing() {
  return (
    <main className="relative min-h-screen">
      {/* The single signature — a hairline filament tracing the left rail,
          close to the viewport edge on wide displays. */}
      <div className="pointer-events-none absolute inset-y-0 left-6 hidden xl:block">
        <div className="filament" />
      </div>

      {/* Top rail */}
      <header className="mx-auto flex max-w-[1120px] items-center justify-between px-6 pt-8 pb-6">
        <Link href="/" aria-label="Kelp home">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-9 text-[13.5px] text-[color:var(--color-paper-300)] md:flex">
          <a href="#install" className="transition-colors hover:text-[color:var(--color-paper-50)]">Install</a>
          <a href="#checks" className="transition-colors hover:text-[color:var(--color-paper-50)]">Coverage</a>
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="transition-colors hover:text-[color:var(--color-paper-50)]"
          >
            Docs ↗
          </a>
        </nav>
        <div className="flex items-center gap-5">
          <Link
            href="/dashboard"
            className="text-[13.5px] text-[color:var(--color-paper-400)] transition-colors hover:text-[color:var(--color-paper-50)]"
          >
            Hosted app
          </Link>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            className={buttonClasses("primary", "md", "cta-lift")}
          >
            Star on GitHub
          </a>
        </div>
      </header>

      {/* Hairline under the rail */}
      <div className="mx-auto max-w-[1120px] px-6">
        <div className="h-px w-full bg-[color:var(--color-hair)]" />
      </div>

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1120px] px-6 pt-24 pb-28 sm:pt-32">
        <div className="grid gap-14 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-7">
            <Reveal>
              <Eyebrow n="§ 00">Open source · MIT</Eyebrow>
            </Reveal>
            <Reveal delay={120} duration={720}>
              <h1 className="font-display mt-8 text-[56px] leading-[0.98] text-[color:var(--color-paper-50)] sm:text-[72px] lg:text-[84px]">
                AI wrote your app.<br />
                Kelp finds the doors it left <span className="italic text-[color:var(--color-paper-300)]">open</span>.
              </h1>
            </Reveal>
            <Reveal delay={280}>
              <p className="mt-8 max-w-[560px] text-[17px] leading-[1.6] text-[color:var(--color-paper-300)]">
                Open-source security scanner for vibe-coded apps. Hardcoded secrets, permissive
                Supabase RLS, unauthenticated edge functions — Kelp probes the way an attacker
                would and hands you the fix, ready to paste back into whatever AI tool built the app.
              </p>
            </Reveal>
            <Reveal delay={400}>
              <div className="mt-11">
                <FreeScanInput />
              </div>
            </Reveal>
            <Reveal delay={520}>
              <div className="mt-6 flex items-center gap-5">
                <a
                  href="#install"
                  className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-400)] underline-offset-4 transition-colors hover:text-[color:var(--color-paper-50)] hover:underline"
                >
                  Or install locally ↓
                </a>
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-400)] underline-offset-4 transition-colors hover:text-[color:var(--color-paper-50)] hover:underline"
                >
                  Read the source ↗
                </a>
              </div>
            </Reveal>
          </div>

          <div className="lg:col-span-5">
            <MultiAgentConsole />
            <Reveal delay={1520}>
              <p className="mt-4 text-[12px] font-mono uppercase tracking-[0.12em] text-[color:var(--color-paper-500)]">
                An excerpt from an actual dispatch. Nothing invented, nothing dramatised.
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── § 01 · ARCHITECTURE CENTERPIECE ──────────────────────────────── */}
      <section className="border-y border-[color:var(--color-hair)] bg-[color:var(--color-ink-900)]/40">
        <div className="mx-auto max-w-[1120px] px-6 py-20 sm:py-28">
          <Reveal>
            <div className="eyebrow flex items-center gap-3">
              <span className="h-px w-6 bg-[color:var(--color-hair-strong)]" aria-hidden />
              <span>§ 01 · How it moves</span>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <h2 className="font-display mt-6 max-w-[820px] text-[36px] leading-[1.05] text-[color:var(--color-paper-50)] sm:text-[48px]">
              Four specialists probe in parallel.
              <br />
              <span className="text-[color:var(--color-paper-300)]">
                A reviewer keeps the honest ones.
              </span>
            </h2>
          </Reveal>
          <Reveal delay={240}>
            <p className="mt-6 max-w-[560px] text-[15px] leading-[1.65] text-[color:var(--color-paper-300)]">
              Every finding is evidence-gated: Kelp&rsquo;s reviewer re-runs the reproduction before it lands in
              your report. Nothing invented, nothing hand-waved. Hover a specialist to see its beat.
            </p>
          </Reveal>
          <div className="mt-12">
            {/* No Reveal here — the SVG has its own internal loop, and IO
                sometimes fails to trigger on the initial layout for very
                tall (440px) children below the fold on slow mounts. */}
            <ArchitectureCenterpiece />
          </div>
        </div>
      </section>

      {/* ── COVERAGE ─────────────────────────────────────────────────────── */}
      <section id="checks" className="mx-auto max-w-[1120px] px-6 pt-28 pb-24">
        <SectionHead
          eyebrowIndex="§ 02"
          eyebrow="Coverage"
          title="Small on purpose. Every finding is real."
          kicker="Kelp covers the classes that actually breach vibe-coded apps, and it ships evidence for each. Everything else is honestly out of scope — see docs/SECURITY-MODEL.md for what Kelp explicitly won't verify."
        />
        <div className="mt-16 divide-y divide-[color:var(--color-hair)] border-y border-[color:var(--color-hair)]">
          {checks.map((c, i) => (
            <Reveal key={c.tag} delay={i * 90}>
              <div className="grid grid-cols-1 gap-6 py-10 lg:grid-cols-12 lg:gap-10">
                <div className="lg:col-span-3">
                  <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-signal-dim)]">
                    {c.tag}
                  </div>
                  <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
                    Class {String(i + 1).padStart(2, "0")}
                  </div>
                </div>
                <div className="lg:col-span-9">
                  <h3 className="font-display text-[26px] leading-[1.15] text-[color:var(--color-paper-50)]">
                    {c.title}
                  </h3>
                  <p className="mt-4 max-w-[62ch] text-[15px] leading-[1.7] text-[color:var(--color-paper-300)]">
                    {c.body}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── INSTALL / SURFACES ───────────────────────────────────────────── */}
      <section id="install" className="border-y border-[color:var(--color-hair)] bg-[color:var(--color-ink-900)]/40">
        <div className="mx-auto max-w-[1120px] px-6 py-24">
          <SectionHead
            eyebrowIndex="§ 03"
            eyebrow="Install"
            title="One engine. Three surfaces. Pick what fits."
            kicker="The detection engine is the same everywhere. Run it locally with the CLI, gate PRs with the GitHub Action, or connect a repo to the hosted app for continuous scanning. None of them require a Kelp account by default."
          />
          <div className="mt-14 grid grid-cols-1 gap-y-12 md:grid-cols-3 md:gap-x-10 md:gap-y-0 md:divide-x md:divide-[color:var(--color-hair)]">
            {surfaces.map((s, i) => (
              <Reveal key={s.n} delay={i * 100}>
                <div className="md:px-8 first:md:pl-0 last:md:pr-0">
                  <div className="font-mono tabular text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-signal-dim)]">
                    Surface {s.n}
                  </div>
                  <h3 className="font-display mt-5 text-[24px] leading-[1.15] text-[color:var(--color-paper-50)]">
                    {s.t}
                  </h3>
                  <p className="mt-4 text-[14.5px] leading-[1.7] text-[color:var(--color-paper-300)]">
                    {s.d}
                  </p>
                  <CodeSnippet>{s.code}</CodeSnippet>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── EVIDENCE-GATING ─────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1120px] px-6 py-24">
        <SectionHead
          eyebrowIndex="§ 04"
          eyebrow="Evidence-gating"
          title="Kelp's model never decides a finding is real."
          kicker="Every agent-produced lead requires a reproduction — a probe with an expected observable, or a source citation. The executor re-runs it. Only findings that survive the re-run reach your report. Autonomy in reasoning, zero fabrication."
        />
        <div className="mt-14 grid grid-cols-1 gap-y-10 md:grid-cols-3 md:gap-x-10 md:gap-y-0 md:divide-x md:divide-[color:var(--color-hair)]">
          {[
            {
              n: "01",
              t: "Agents reason, the executor proves.",
              d: "Specialists form hypotheses freely; the executor accepts them only when the exploit reproduces against your actual endpoints, with real user context.",
            },
            {
              n: "02",
              t: "The reviewer only narrows.",
              d: "A second pass reads each specialist's transcript, spawns targeted follow-ups, and drops the leads that don't reproduce. It never adds noise.",
            },
            {
              n: "03",
              t: "Full transcript per finding.",
              d: "Every finding ships with the reasoning, the probe, and the response — the receipt for exactly how Kelp knows. Read the full principle in docs/EVIDENCE-GATING.md.",
            },
          ].map((s, i) => (
            <Reveal key={s.n} delay={i * 100}>
              <div className="md:px-8 first:md:pl-0 last:md:pr-0">
                <div className="font-mono tabular text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-signal-dim)]">
                  Invariant · {s.n}
                </div>
                <h3 className="font-display mt-5 text-[24px] leading-[1.15] text-[color:var(--color-paper-50)]">
                  {s.t}
                </h3>
                <p className="mt-4 text-[14.5px] leading-[1.7] text-[color:var(--color-paper-300)]">
                  {s.d}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section className="border-y border-[color:var(--color-hair)] bg-[color:var(--color-ink-900)]/40">
        <div className="mx-auto max-w-[1120px] px-6 py-24">
          <SectionHead
            eyebrowIndex="§ 05"
            eyebrow="Questions"
            title="What people ask before they run Kelp."
          />
          <div className="mt-14 divide-y divide-[color:var(--color-hair)] border-y border-[color:var(--color-hair)]">
            {faqs.map((f, i) => (
              <Reveal key={f.q} delay={i * 80}>
                <div className="grid grid-cols-1 gap-6 py-10 lg:grid-cols-12 lg:gap-10">
                  <div className="lg:col-span-2">
                    <div className="font-mono tabular text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
                      Q · {String(i + 1).padStart(2, "0")}
                    </div>
                  </div>
                  <div className="lg:col-span-10">
                    <h3 className="font-display text-[22px] leading-[1.2] text-[color:var(--color-paper-50)]">
                      {f.q}
                    </h3>
                    <p className="mt-3 max-w-[70ch] text-[14.5px] leading-[1.7] text-[color:var(--color-paper-300)]">
                      {f.a}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── CLOSING CTA ──────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1120px] px-6 py-28">
        <Reveal>
          <div className="border border-[color:var(--color-hair-strong)] px-8 py-14 sm:px-14 sm:py-20">
            <div className="grid gap-10 lg:grid-cols-12">
              <div className="lg:col-span-8">
                <Eyebrow n="§ 06">Ship it</Eyebrow>
                <h2 className="font-display mt-6 text-[42px] leading-[1.05] text-[color:var(--color-paper-50)] sm:text-[52px]">
                  Scan your app before your users do.
                </h2>
                <p className="mt-5 max-w-[52ch] text-[15.5px] leading-[1.6] text-[color:var(--color-paper-300)]">
                  Two minutes with the CLI. Six lines of YAML for the Action. Kelp is
                  MIT-licensed — clone it, fork it, or send a PR to add the vuln class
                  you wish it caught.
                </p>
              </div>
              <div className="flex flex-col items-start gap-3 lg:col-span-4 lg:items-end lg:justify-end">
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={buttonClasses("primary", "lg", "cta-lift")}
                >
                  Star on GitHub
                </a>
                <a
                  href={ACTION_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-400)] underline-offset-4 transition-colors hover:text-[color:var(--color-paper-50)] hover:underline"
                >
                  Or add the GitHub Action ↗
                </a>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-[color:var(--color-hair)]">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
            © {new Date().getFullYear()} Kelp · MIT · built by <a href="https://github.com/Mic52M" target="_blank" rel="noreferrer noopener" className="hover:text-[color:var(--color-paper-50)]">@Mic52M</a>
          </div>
          <nav className="flex flex-wrap items-center gap-6 text-[12.5px] text-[color:var(--color-paper-400)]">
            <a href={REPO_URL} target="_blank" rel="noreferrer noopener" className="hover:text-[color:var(--color-paper-50)]">GitHub</a>
            <a href={DOCS_URL} target="_blank" rel="noreferrer noopener" className="hover:text-[color:var(--color-paper-50)]">Docs</a>
            <a href={`${REPO_URL}/blob/master/SECURITY.md`} target="_blank" rel="noreferrer noopener" className="hover:text-[color:var(--color-paper-50)]">Security</a>
            <Link href="/docs/action" className="hover:text-[color:var(--color-paper-50)]">Action</Link>
            <Link href="/dashboard" className="hover:text-[color:var(--color-paper-50)]">Hosted app</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
