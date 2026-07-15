import Link from "next/link";
import { buttonClasses } from "@/components/Button";
import { Logo } from "@/components/Logo";
import { Reveal } from "@/components/Reveal";
import { CountUp } from "@/components/CountUp";
import { FreeScanInput } from "@/components/free-scan/FreeScanInput";
import { MultiAgentConsole } from "@/components/MultiAgentConsole";

/* ── Copy ──────────────────────────────────────────────────────────────────── */

const checks = [
  {
    tag: "RLS-001",
    title: "Row-Level Security, checked policy-by-policy.",
    body:
      "Kelp reads your Supabase schema and finds the tables and columns anyone can read or write. Fixes ship as an owner-scoped policy you can review before running.",
  },
  {
    tag: "SEC-002",
    title: "Secrets exfiltrated by the frontend.",
    body:
      "Service-role keys, Stripe secrets, and OpenAI tokens committed to the client bundle. Kelp opens a pull request that moves them to env vars and flags rotation.",
  },
  {
    tag: "BOLA-003",
    title: "Broken object authorization, actively probed.",
    body:
      "With your consent, one authenticated user tries to reach another's data by ID. It's the exact failure behind the loudest public breaches of AI-generated apps.",
  },
];

const steps = [
  { n: "01", t: "Connect", d: "Sign in with GitHub and link your Supabase project. Scoped tokens only — the service_role key stays in your project." },
  { n: "02", t: "Scan",    d: "Kelp reads your schema and code, then runs authorized probes. Every request is logged in your audit trail." },
  { n: "03", t: "Fix",     d: "Read a plain-language report, apply ready-made fixes with one click, and stay covered on every push to main." },
];

const faqs = [
  {
    q: "Do I need to give Kelp my Supabase service-role key?",
    a: "No. Kelp connects with a scoped Management API token, and we are moving to a per-project read-only Postgres role. Your service-role key never leaves your project.",
  },
  {
    q: "Will Kelp change anything in my code without asking?",
    a: "Never. Fixes for secrets are opened as pull requests against a fresh kelp/… branch, never pushed to your default branch. Database fixes are proposed as migrations you review and run yourself.",
  },
  {
    q: "How is active testing safe on my production app?",
    a: "Every campaign runs through a hard consent gate you accept per project — no consent, no probe. Evidence is stored as category plus count, never raw customer data, and every request is auditable.",
  },
  {
    q: "Does Kelp claim to find every vulnerability?",
    a: "No. We cover a small set of high-impact classes with high precision — the ones that actually breach AI-generated apps. Real fixes for RLS, secrets, and broken authorization beat a forty-page report of maybes.",
  },
];

const tiers = [
  { name: "Free",    price: "0",  cadence: "one scan",          tag: "One full scan, report only.",     features: ["1 project", "All three checks", "Full findings report"], cta: "Start free scan", href: "/onboarding" },
  { name: "Starter", price: "29", cadence: "per month",         tag: "Continuous cover for your app.",  features: ["1 project", "Continuous scanning", "Auto-fix for RLS & secrets", "Re-scan on every push"], cta: "Choose Starter", href: "/onboarding", featured: true },
  { name: "Agency",  price: "89", cadence: "per month",         tag: "For studios shipping many apps.", features: ["Up to 5 projects", "Everything in Starter", "Priority human review", "Email alerts"], cta: "Choose Agency", href: "/onboarding" },
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

/* ── Page ──────────────────────────────────────────────────────────────────── */

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
          <a href="#checks" className="transition-colors hover:text-[color:var(--color-paper-50)]">What we check</a>
          <a href="#how" className="transition-colors hover:text-[color:var(--color-paper-50)]">How it works</a>
          <a href="#pricing" className="transition-colors hover:text-[color:var(--color-paper-50)]">Pricing</a>
        </nav>
        <div className="flex items-center gap-5">
          <Link
            href="/dashboard"
            className="text-[13.5px] text-[color:var(--color-paper-300)] transition-colors hover:text-[color:var(--color-paper-50)]"
          >
            Sign in
          </Link>
          <Link href="/onboarding" className={buttonClasses("primary", "md", "cta-lift")}>
            Start free scan
          </Link>
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
              <Eyebrow n="§ 00">Security review · vibe-coded apps</Eyebrow>
            </Reveal>
            <Reveal delay={120} duration={720}>
              <h1 className="font-display mt-8 text-[56px] leading-[0.98] text-[color:var(--color-paper-50)] sm:text-[72px] lg:text-[84px]">
                AI wrote your app.<br />
                Kelp finds the doors it left <span className="italic text-[color:var(--color-paper-300)]">open</span>.
              </h1>
            </Reveal>
            <Reveal delay={280}>
              <p className="mt-8 max-w-[560px] text-[17px] leading-[1.6] text-[color:var(--color-paper-300)]">
                The security agent for vibe-coded apps. We probe your backend the way an attacker would —
                with real user context, no theatre — and hand you the fix, ready to paste back into
                whatever AI tool built it.
              </p>
            </Reveal>
            <Reveal delay={400}>
              <div className="mt-11">
                <FreeScanInput />
              </div>
            </Reveal>
            <Reveal delay={520}>
              <div className="mt-6">
                <a
                  href="#how"
                  className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-400)] underline-offset-4 transition-colors hover:text-[color:var(--color-paper-50)] hover:underline"
                >
                  Or see how it works ↓
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

      {/* ── STAT STRIP ───────────────────────────────────────────────────── */}
      <section className="border-y border-[color:var(--color-hair)] bg-[color:var(--color-ink-900)]/40">
        <div className="mx-auto grid max-w-[1120px] grid-cols-1 divide-y divide-[color:var(--color-hair)] px-6 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {[
            { count: 62,   fmt: "percent" as const,     label: "of AI-generated apps ship a security flaw" },
            { count: 3,    fmt: "plain" as const,       label: "classes covered end-to-end, with real evidence" },
            { count: 10,   fmt: "lessThanMin" as const, label: "median time to first actionable fix" },
          ].map((k, i) => (
            <Reveal key={k.label} delay={i * 90}>
              <div className="px-6 py-10 sm:px-10">
                <CountUp
                  to={k.count}
                  format={k.fmt}
                  duration={1600}
                  className="font-display tabular text-[44px] leading-none text-[color:var(--color-paper-50)]"
                />
                <div className="mt-4 text-[13.5px] leading-snug text-[color:var(--color-paper-400)]">
                  {k.label}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── WHAT WE CHECK ────────────────────────────────────────────────── */}
      <section id="checks" className="mx-auto max-w-[1120px] px-6 pt-28 pb-24">
        <SectionHead
          eyebrowIndex="§ 01"
          eyebrow="Coverage"
          title="Three classes. Real evidence. No wall of warnings."
          kicker="We cover the vulnerabilities that actually breach AI-generated apps, and we ship a fix for each. Everything else is honestly out of scope."
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

      {/* ── HOW IT WORKS ─────────────────────────────────────────────────── */}
      <section id="how" className="border-y border-[color:var(--color-hair)] bg-[color:var(--color-ink-900)]/40">
        <div className="mx-auto max-w-[1120px] px-6 py-24">
          <SectionHead
            eyebrowIndex="§ 02"
            eyebrow="How it works"
            title="Connect, scan, fix. In that order."
          />
          <div className="mt-16 grid grid-cols-1 gap-y-12 md:grid-cols-3 md:gap-x-10 md:gap-y-0 md:divide-x md:divide-[color:var(--color-hair)]">
            {steps.map((s, i) => (
              <Reveal key={s.n} delay={i * 100}>
                <div className="md:px-8 first:md:pl-0 last:md:pr-0">
                  <div className="font-mono tabular text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-signal-dim)]">
                    Step {s.n}
                  </div>
                  <h3 className="font-display mt-5 text-[28px] leading-[1.1] text-[color:var(--color-paper-50)]">
                    {s.t}
                  </h3>
                  <p className="mt-4 text-[14.5px] leading-[1.7] text-[color:var(--color-paper-300)]">
                    {s.d}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── PROVEN, NOT THEORETICAL ─────────────────────────────────────── */}
      <section className="mx-auto max-w-[1120px] px-6 py-24">
        <SectionHead
          eyebrowIndex="§ 02b"
          eyebrow="Evidence, not maybes"
          title="Proven, not theoretical."
          kicker="Every finding Kelp files has been reproduced. Our executor re-runs the model's exploit before it becomes a ticket — no observable, no finding. That's why our reports are shorter than a scanner's, and why every line is real."
        />
        <div className="mt-14 grid grid-cols-1 gap-y-10 md:grid-cols-3 md:gap-x-10 md:gap-y-0 md:divide-x md:divide-[color:var(--color-hair)]">
          {[
            {
              n: "01",
              t: "Agents reason, adversaries prove.",
              d: "Kelp's agents form hypotheses freely; the executor accepts them only when the exploit reproduces against your actual endpoints, with real user context.",
            },
            {
              n: "02",
              t: "Auth model as ground truth.",
              d: "Before any finding is filed, Kelp derives your app's auth model — cookies, CORS, JWTs, one-time tokens — and refuses findings that don't survive it. No CSRF cries on bearer-JWT apps.",
            },
            {
              n: "03",
              t: "Full transcript per finding.",
              d: "Every finding ships with the reasoning, the probe, and the response. Not a black box — the receipt for exactly how we know.",
            },
          ].map((s, i) => (
            <Reveal key={s.n} delay={i * 100}>
              <div className="md:px-8 first:md:pl-0 last:md:pr-0">
                <div className="font-mono tabular text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-signal-dim)]">
                  Guarantee · {s.n}
                </div>
                <h3 className="font-display mt-5 text-[26px] leading-[1.15] text-[color:var(--color-paper-50)]">
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

      {/* ── PRICING ──────────────────────────────────────────────────────── */}
      <section id="pricing" className="border-y border-[color:var(--color-hair)]">
        <div className="mx-auto max-w-[1120px] px-6 py-24">
          <SectionHead
            eyebrowIndex="§ 03"
            eyebrow="Pricing"
            title="Simple, per-project, no seat count."
            kicker="Every plan gets the same three checks. Paid plans add continuous cover, auto-fix, and priority review."
          />
          <div className="mt-14 divide-y divide-[color:var(--color-hair)] border-y border-[color:var(--color-hair)]">
            {tiers.map((t, i) => (
              <Reveal key={t.name} delay={i * 90}>
                <div className="grid grid-cols-1 gap-8 py-10 lg:grid-cols-12 lg:items-center lg:gap-10">
                  <div className="lg:col-span-3">
                    <div className="flex items-center gap-3">
                      <span className="font-display text-[28px] leading-none text-[color:var(--color-paper-50)]">
                        {t.name}
                      </span>
                      {t.featured && (
                        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-signal)]">
                          Recommended
                        </span>
                      )}
                    </div>
                    <div className="mt-3 flex items-baseline gap-2">
                      <span className="font-display tabular text-[44px] leading-none text-[color:var(--color-paper-50)]">
                        €{t.price}
                      </span>
                      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
                        {t.cadence}
                      </span>
                    </div>
                  </div>
                  <div className="lg:col-span-6">
                    <p className="text-[14.5px] leading-[1.6] text-[color:var(--color-paper-300)]">
                      {t.tag}
                    </p>
                    <ul className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
                      {t.features.map((f) => (
                        <li
                          key={f}
                          className="flex items-start gap-2 font-mono text-[12.5px] text-[color:var(--color-paper-300)]"
                        >
                          <span
                            aria-hidden
                            className="mt-[7px] inline-block h-px w-3 bg-[color:var(--color-signal-dim)]"
                          />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="lg:col-span-3 lg:text-right">
                    <Link
                      href={t.href}
                      className={buttonClasses(t.featured ? "primary" : "secondary", "lg", "cta-lift")}
                    >
                      {t.cta}
                    </Link>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1120px] px-6 py-24">
        <SectionHead
          eyebrowIndex="§ 04"
          eyebrow="Questions"
          title="What people ask before they connect a repo."
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
      </section>

      {/* ── CLOSING CTA ──────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1120px] px-6 pb-28">
        <Reveal>
          <div className="border border-[color:var(--color-hair-strong)] px-8 py-14 sm:px-14 sm:py-20">
            <div className="grid gap-10 lg:grid-cols-12">
              <div className="lg:col-span-8">
                <Eyebrow n="§ 05">Ready</Eyebrow>
                <h2 className="font-display mt-6 text-[42px] leading-[1.05] text-[color:var(--color-paper-50)] sm:text-[52px]">
                  Scan your app before your users do.
                </h2>
                <p className="mt-5 max-w-[52ch] text-[15.5px] leading-[1.6] text-[color:var(--color-paper-300)]">
                  Connect a GitHub repo, accept the consent, and see your first findings within ten minutes.
                  Free plan is a real full scan, not a teaser.
                </p>
              </div>
              <div className="flex items-end lg:col-span-4 lg:justify-end">
                <Link href="/onboarding" className={buttonClasses("primary", "lg", "cta-lift")}>
                  Start free scan
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-[color:var(--color-hair)]">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-8 px-6 py-12 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Logo />
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
              Made in Europe
            </span>
          </div>
          <nav className="flex flex-wrap gap-x-7 gap-y-2 font-mono text-[12px] text-[color:var(--color-paper-400)]">
            <a href="#checks" className="hover:text-[color:var(--color-paper-50)]">Coverage</a>
            <a href="#how" className="hover:text-[color:var(--color-paper-50)]">How</a>
            <a href="#pricing" className="hover:text-[color:var(--color-paper-50)]">Pricing</a>
            <Link href="/dashboard" className="hover:text-[color:var(--color-paper-50)]">Dashboard</Link>
            <a href="mailto:hello@kelp.build" className="hover:text-[color:var(--color-paper-50)]">Contact</a>
          </nav>
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
            © 2026 Kelp Labs
          </div>
        </div>
      </footer>
    </main>
  );
}
