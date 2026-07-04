import Link from "next/link";
import { buttonClasses } from "@/components/Button";
import { CountUp } from "@/components/CountUp";
import { Logo } from "@/components/Logo";
import { Reveal } from "@/components/Reveal";
import { ScanConsole } from "@/components/ScanConsole";
import { scanSteps } from "@/lib/mock";

const checks = [
  {
    tag: "RLS",
    title: "Missing Row Level Security",
    body: "We read your Supabase schema and catch tables anyone can read or write — then generate the owner-scoped policy for you to review.",
  },
  {
    tag: "Secrets",
    title: "Leaked keys & credentials",
    body: "Service_role keys, Stripe and AWS secrets committed to your frontend. We open a pull request that moves them to env vars and flag rotation.",
  },
  {
    tag: "BOLA",
    title: "Broken object authorization",
    body: "With your consent, we actively test whether one user can reach another user's data by ID — the exact flaw behind the Lovable and Moltbook breaches.",
  },
];

const steps = [
  { n: "01", t: "Connect", d: "Sign in with GitHub and link your Supabase project. Minimal scopes, no service_role key required." },
  { n: "02", t: "Scan", d: "Kelp reads your schema and code and runs authorized tests — live, in under ten minutes." },
  { n: "03", t: "Fix", d: "Review a plain-language report, apply ready-made fixes with one click, and stay covered on every push." },
];

const tiers = [
  { name: "Free", price: "€0", tagline: "One full scan, report only.", features: ["1 project", "All three checks", "Full findings report"], cta: "Start free scan", highlight: false },
  { name: "Starter", price: "€29", tagline: "Continuous cover for your app.", features: ["1 project", "Continuous scanning", "Auto-fix for RLS & secrets", "Re-scan on every push"], cta: "Choose Starter", highlight: true },
  { name: "Agency", price: "€89", tagline: "For studios shipping many apps.", features: ["Up to 5 projects", "Everything in Starter", "Priority human review", "Email alerts"], cta: "Choose Agency", highlight: false },
];

export default function Landing() {
  return (
    <main className="relative">
      {/* Nav */}
      <header className="relative z-20 mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <nav className="hidden items-center gap-8 text-sm text-fog-300 md:flex">
          <a href="#checks" className="transition-colors hover:text-fog-50">What we check</a>
          <a href="#how" className="transition-colors hover:text-fog-50">How it works</a>
          <a href="#pricing" className="transition-colors hover:text-fog-50">Pricing</a>
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-fog-300 transition-colors hover:text-fog-50">
            Sign in
          </Link>
          <Link href="/onboarding" className={buttonClasses("primary")}>
            Start free scan
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="aurora hero-glow" />
        <div className="grid-texture absolute inset-0" />
        <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-12 px-6 pb-24 pt-16 lg:grid-cols-2 lg:pt-24">
          <div>
            <Reveal>
              <div className="inline-flex items-center gap-2 rounded-full border border-line bg-ink-800/60 px-3 py-1 text-xs text-fog-300">
                <span className="h-1.5 w-1.5 rounded-full bg-aqua-400 animate-pulse-soft" />
                Built for Lovable · Bolt · Replit · Cursor + Supabase
              </div>
            </Reveal>
            <Reveal delay={80}>
              <h1 className="mt-5 text-balance text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.4rem]">
                Ship your app without <span className="accent-text">shipping its security holes.</span>
              </h1>
            </Reveal>
            <Reveal delay={160}>
              <p className="mt-5 max-w-lg text-lg leading-relaxed text-fog-300">
                Up to 62% of AI-generated code ships with a security flaw. Kelp finds the ones
                that matter in your Supabase app — missing RLS, leaked keys, broken
                authorization — and hands you the fix. No security team required.
              </p>
            </Reveal>
            <Reveal delay={240}>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  href="/onboarding"
                  className="group relative overflow-hidden rounded-xl bg-gradient-to-r from-aqua-400 to-aqua-600 px-5 py-3 text-sm font-semibold text-ink-950 transition-all hover:shadow-[0_0_32px_-4px_rgba(52,230,207,0.55)] hover:-translate-y-0.5"
                >
                  <span className="relative z-10">Scan my app free</span>
                  <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full" />
                </Link>
                <a
                  href="#how"
                  className="rounded-xl border border-line bg-ink-800/50 px-5 py-3 text-sm font-medium text-fog-50 transition-all hover:-translate-y-0.5 hover:border-white/10 hover:bg-ink-700"
                >
                  See how it works
                </a>
              </div>
            </Reveal>
            <Reveal delay={320}>
              <p className="mt-4 text-xs text-fog-500">
                No credit card. First scan in under 10 minutes. We never claim 100% coverage —
                we cover specific vulnerability classes with high precision.
              </p>
            </Reveal>
          </div>

          <Reveal delay={200}>
            <div className="relative">
              <ScanConsole steps={scanSteps} />
            </div>
          </Reveal>
        </div>

        {/* Scroll cue — restrained, fades out after a couple of viewports */}
        <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 text-fog-500 opacity-60">
          <svg width="20" height="30" viewBox="0 0 20 30" fill="none" className="animate-pulse-soft">
            <rect x="1" y="1" width="18" height="28" rx="9" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="10" cy="9" r="1.5" fill="currentColor">
              <animate attributeName="cy" from="9" to="20" dur="1.6s" repeatCount="indefinite" />
              <animate attributeName="opacity" from="1" to="0" dur="1.6s" repeatCount="indefinite" />
            </circle>
          </svg>
        </div>
      </section>

      {/* Stat strip — numbers count up as they enter view */}
      <section className="relative z-10 border-y border-line/70 bg-ink-900/40">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px px-6 md:grid-cols-4">
          {([
            { to: 62, format: "rangeUpToPct", small: "of AI-generated code has a vulnerability" },
            { to: 5600, format: "plus", small: "public vibe-coded apps scanned by researchers" },
            { to: 2000, format: "plus", small: "critical issues those scans surfaced" },
            { to: 10, format: "lessThanMin", small: "from sign-up to your first real result" },
          ] as const).map((stat, i) => (
            <Reveal key={stat.small} delay={i * 80} className="py-8 text-center">
              <CountUp to={stat.to} format={stat.format} className="text-2xl font-semibold accent-text" />
              <div className="mx-auto mt-1 max-w-[15rem] text-xs text-fog-400">{stat.small}</div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Checks */}
      <section id="checks" className="mx-auto max-w-6xl px-6 py-24">
        <div className="max-w-2xl">
          <Reveal>
            <div className="text-sm font-medium text-aqua-400">What Kelp checks</div>
          </Reveal>
          <Reveal delay={60}>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              The three classes that actually get apps breached.
            </h2>
          </Reveal>
          <Reveal delay={140}>
            <p className="mt-3 text-fog-300">
              Not a 40-page report. The specific, high-impact flaws behind the incidents you
              read about — each with a fix, not just a finding.
            </p>
          </Reveal>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {checks.map((c, i) => (
            <Reveal key={c.tag} delay={i * 120}>
              <div className="card-shine group glass h-full rounded-2xl p-6 transition-all duration-500 hover:-translate-y-1 hover:border-aqua-600/40 hover:shadow-[0_20px_60px_-30px_rgba(52,230,207,0.4)]">
                <div className="inline-flex rounded-md border border-line bg-ink-800 px-2 py-0.5 font-mono text-xs text-aqua-400 transition-colors group-hover:border-aqua-600/40 group-hover:text-aqua-300">
                  {c.tag}
                </div>
                <h3 className="mt-4 text-lg font-medium">{c.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-fog-300">{c.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-t border-line/70 bg-ink-900/30">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <Reveal>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              From sign-up to fixed in three steps.
            </h2>
          </Reveal>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {steps.map((s, i) => (
              <Reveal key={s.n} delay={i * 140}>
                <div className="group relative">
                  <div className="font-mono text-sm text-aqua-400 transition-colors group-hover:text-aqua-300">
                    {s.n}
                  </div>
                  <div className="mt-2 h-px w-full bg-gradient-to-r from-aqua-500/40 to-transparent transition-all duration-500 group-hover:from-aqua-400/60" />
                  <h3 className="mt-4 text-xl font-medium">{s.t}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-fog-300">{s.d}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-6xl px-6 py-24">
        <Reveal>
          <div className="text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Priced for indie builders, not enterprises.
            </h2>
            <p className="mt-3 text-fog-300">
              Start free. Upgrade when you want continuous cover and one-click fixes.
            </p>
          </div>
        </Reveal>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {tiers.map((t, i) => (
            <Reveal key={t.name} delay={i * 100}>
              <div
                className={`card-shine relative h-full rounded-2xl p-6 transition-all duration-500 hover:-translate-y-1 ${
                  t.highlight
                    ? "border border-aqua-600/50 bg-gradient-to-b from-aqua-500/[0.08] to-transparent hover:shadow-[0_24px_80px_-30px_rgba(52,230,207,0.45)]"
                    : "glass hover:border-white/10 hover:shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)]"
                }`}
              >
                {t.highlight && (
                  <div className="absolute -top-3 left-6 rounded-full bg-aqua-500 px-2.5 py-0.5 text-xs font-medium text-ink-950 shadow-[0_0_18px_-2px_rgba(52,230,207,0.7)]">
                    Most popular
                  </div>
                )}
                <div className="text-sm text-fog-300">{t.name}</div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-4xl font-semibold">{t.price}</span>
                  <span className="text-sm text-fog-400">/mo</span>
                </div>
                <div className="mt-1 text-sm text-fog-400">{t.tagline}</div>
                <ul className="mt-5 space-y-2.5 text-sm">
                  {t.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-fog-300">
                      <span className="text-aqua-400">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/onboarding"
                  className={`mt-6 block rounded-lg px-4 py-2.5 text-center text-sm font-medium transition-all hover:-translate-y-0.5 ${
                    t.highlight
                      ? "bg-gradient-to-r from-aqua-400 to-aqua-600 text-ink-950 hover:shadow-[0_0_24px_-4px_rgba(52,230,207,0.6)]"
                      : "border border-line bg-ink-800 text-fog-50 hover:bg-ink-700"
                  }`}
                >
                  {t.cta}
                </Link>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-line/70">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 sm:flex-row">
          <Logo />
          <p className="text-xs text-fog-500">© 2026 Kelp. Security for the way you build now.</p>
          <div className="flex gap-5 text-xs text-fog-400">
            <a href="#" className="hover:text-fog-50">Privacy</a>
            <a href="#" className="hover:text-fog-50">Terms</a>
            <a href="#" className="hover:text-fog-50">Security</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
