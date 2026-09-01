// Docs hub. Intentionally short — lists the on-site quickstarts + deeper
// GitHub-hosted references. Follows the same editorial-industrial aesthetic
// as the landing.

import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";

export const metadata: Metadata = {
  title: "Docs · Kelp",
  description:
    "Documentation for Kelp — the open-source security scanner for vibe-coded apps. Quickstarts for CLI and GitHub Action, plus links to architecture, security model, and contributor guides.",
};

const REPO = "https://github.com/Mic52M/kelp/blob/master";

interface Entry {
  title: string;
  body: string;
  href: string;
  external?: boolean;
}

const onSite: Entry[] = [
  {
    title: "Quickstart",
    body: "Install the CLI and get your first finding in under a minute.",
    href: "/docs/quickstart",
  },
  {
    title: "GitHub Action",
    body: "Fail PRs on new critical or high findings. Setup + required-check config.",
    href: "/docs/action",
  },
];

const references: Entry[] = [
  {
    title: "Architecture",
    body: "How the CLI, worker, and hosted app share one detection engine. Package boundaries, scan pipeline, a where-do-I-look cheat sheet.",
    href: `${REPO}/docs/ARCHITECTURE.md`,
    external: true,
  },
  {
    title: "CLI reference",
    body: "Every command, every flag, exit codes, JSON output schema, comparison with the Action and hosted surfaces.",
    href: `${REPO}/docs/CLI.md`,
    external: true,
  },
  {
    title: "Evidence gating",
    body: "The anti-fabrication invariant behind every Kelp finding — the model never decides a finding is real.",
    href: `${REPO}/docs/EVIDENCE-GATING.md`,
    external: true,
  },
  {
    title: "Security model",
    body: "What Kelp does and doesn't verify. Threat model against Kelp itself. What's in and out of scope.",
    href: `${REPO}/docs/SECURITY-MODEL.md`,
    external: true,
  },
  {
    title: "Backend adapters",
    body: "The north star for extending Kelp beyond Supabase (Firebase, Convex, Neon, PocketBase). Priority order + contributor checklist.",
    href: `${REPO}/docs/ADAPTERS.md`,
    external: true,
  },
  {
    title: "Contributing",
    body: "Dev setup, conventions, first-detection walkthrough. Read this before opening a PR.",
    href: `${REPO}/CONTRIBUTING.md`,
    external: true,
  },
  {
    title: "Security policy",
    body: "How to responsibly report a vulnerability in Kelp itself. Do NOT use public issues.",
    href: `${REPO}/SECURITY.md`,
    external: true,
  },
];

export default function DocsHub() {
  return (
    <main className="relative min-h-screen">
      <div className="pointer-events-none absolute inset-y-0 left-6 hidden xl:block">
        <div className="filament" />
      </div>

      {/* Nav — same rail as landing, minus the CTA weight. */}
      <header className="mx-auto flex max-w-[1120px] items-center justify-between px-6 pt-8 pb-6">
        <Link href="/" aria-label="Kelp home">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-8 text-[13.5px] text-[color:var(--color-paper-300)] md:flex">
          <Link href="/docs" className="text-[color:var(--color-paper-50)]">Docs</Link>
          <a
            href="https://github.com/Mic52M/kelp"
            target="_blank"
            rel="noreferrer noopener"
            className="transition-colors hover:text-[color:var(--color-paper-50)]"
          >
            GitHub ↗
          </a>
        </nav>
        <div className="flex items-center gap-5">
          <Link
            href="/dashboard"
            className="hidden text-[13.5px] text-[color:var(--color-paper-400)] transition-colors hover:text-[color:var(--color-paper-50)] sm:inline"
          >
            Hosted app
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-[1120px] px-6">
        <div className="h-px w-full bg-[color:var(--color-hair)]" />
      </div>

      <div className="mx-auto max-w-[820px] px-6 pt-24 pb-32">
        <div className="eyebrow flex items-center gap-3">
          <span className="text-[color:var(--color-signal-dim)]">§ 00</span>
          <span className="h-px w-6 bg-[color:var(--color-hair-strong)]" aria-hidden />
          <span>Documentation</span>
        </div>
        <h1 className="font-display mt-8 text-[52px] leading-[1.02] tracking-[-0.01em] text-[color:var(--color-paper-50)] sm:text-[68px]">
          Docs.
        </h1>
        <p className="mt-6 max-w-[56ch] text-[16.5px] leading-[1.6] text-[color:var(--color-paper-300)]">
          Kelp is small on purpose. Two short quickstarts get you running; the rest
          is reference material for when you want to extend it or verify how it
          works.
        </p>

        {/* On-site quickstarts */}
        <section className="mt-20">
          <div className="mb-8 flex items-baseline justify-between">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--color-paper-500)]">
              Start here
            </h2>
          </div>
          <ul className="divide-y divide-[color:var(--color-hair)] border-y border-[color:var(--color-hair)]">
            {onSite.map((e) => (
              <li key={e.href}>
                <Link
                  href={e.href}
                  className="group grid grid-cols-1 gap-2 py-6 transition-colors hover:bg-[color:var(--color-ink-900)]/40 lg:grid-cols-12 lg:gap-8"
                >
                  <div className="lg:col-span-4">
                    <h3 className="font-display text-[22px] leading-[1.2] text-[color:var(--color-paper-50)] transition-colors group-hover:text-[color:var(--color-signal)]">
                      {e.title} →
                    </h3>
                  </div>
                  <p className="text-[14.5px] leading-[1.6] text-[color:var(--color-paper-300)] lg:col-span-8">
                    {e.body}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* Reference */}
        <section className="mt-20">
          <div className="mb-8 flex items-baseline justify-between">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--color-paper-500)]">
              Reference
            </h2>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
              Full markdown on GitHub
            </span>
          </div>
          <ul className="divide-y divide-[color:var(--color-hair)] border-y border-[color:var(--color-hair)]">
            {references.map((e) => (
              <li key={e.href}>
                <a
                  href={e.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="group grid grid-cols-1 gap-2 py-6 transition-colors hover:bg-[color:var(--color-ink-900)]/40 lg:grid-cols-12 lg:gap-8"
                >
                  <div className="lg:col-span-4">
                    <h3 className="font-display text-[20px] leading-[1.2] text-[color:var(--color-paper-50)] transition-colors group-hover:text-[color:var(--color-signal)]">
                      {e.title} ↗
                    </h3>
                  </div>
                  <p className="text-[14.5px] leading-[1.6] text-[color:var(--color-paper-300)] lg:col-span-8">
                    {e.body}
                  </p>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-20 border-t border-[color:var(--color-hair)] pt-6">
          <Link
            href="/"
            className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)] transition-colors hover:text-[color:var(--color-paper-100)]"
          >
            ← Back home
          </Link>
        </div>
      </div>
    </main>
  );
}
