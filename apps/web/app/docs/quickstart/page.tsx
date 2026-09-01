// The primary on-site doc — the shortest path from "never heard of Kelp"
// to "found my first real vulnerability". Three steps, one page.

import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { CopyableCommand } from "@/components/CopyableCommand";

export const metadata: Metadata = {
  title: "Quickstart · Kelp docs",
  description:
    "Install the Kelp CLI and get your first security finding in under a minute. Zero configuration, zero signup.",
};

export default function Quickstart() {
  return (
    <main className="relative min-h-screen">
      <div className="pointer-events-none absolute inset-y-0 left-6 hidden xl:block">
        <div className="filament" />
      </div>

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
      </header>

      <div className="mx-auto max-w-[1120px] px-6">
        <div className="h-px w-full bg-[color:var(--color-hair)]" />
      </div>

      <div className="mx-auto max-w-[720px] px-6 pt-20 pb-32">
        <div className="eyebrow flex items-center gap-3">
          <Link href="/docs" className="text-[color:var(--color-paper-500)] hover:text-[color:var(--color-paper-100)]">
            Docs
          </Link>
          <span className="text-[color:var(--color-paper-600)]">/</span>
          <span>Quickstart</span>
        </div>
        <h1 className="font-display mt-6 text-[44px] leading-[1.05] tracking-[-0.01em] text-[color:var(--color-paper-50)] sm:text-[56px]">
          Quickstart.
        </h1>
        <p className="mt-5 max-w-[56ch] text-[16px] leading-[1.6] text-[color:var(--color-paper-300)]">
          Three steps. Under a minute. No signup, no config, no keys.
        </p>

        {/* ── STEP 1 ─────────────────────────────────────────────────── */}
        <section className="mt-16">
          <StepLabel n="01" title="Run the scanner" />
          <p className="mt-4 text-[14.5px] leading-[1.65] text-[color:var(--color-paper-300)]">
            Kelp ships as an npm package. If Node ≥ 20 is on your machine,{" "}
            <code className="font-mono text-[13.5px] text-[color:var(--color-paper-100)]">npx</code>{" "}
            will fetch and run it in one shot.
          </p>
          <div className="mt-6">
            <CopyableCommand command="npx @kelp-security/cli scan ." />
          </div>
          <p className="mt-4 text-[13.5px] leading-[1.6] text-[color:var(--color-paper-400)]">
            Prefer a global install?{" "}
            <code className="font-mono text-[13.5px] text-[color:var(--color-paper-100)]">
              npm install -g @kelp-security/cli
            </code>{" "}
            then{" "}
            <code className="font-mono text-[13.5px] text-[color:var(--color-paper-100)]">kelp scan .</code>.
          </p>
        </section>

        {/* ── STEP 2 ─────────────────────────────────────────────────── */}
        <section className="mt-16">
          <StepLabel n="02" title="Read the output" />
          <p className="mt-4 text-[14.5px] leading-[1.65] text-[color:var(--color-paper-300)]">
            Kelp walks the tree, filters out
            <Code>node_modules</Code>, <Code>dist</Code>, <Code>.git</Code>, sourcemaps and lockfiles, then
            runs the secret scanner. Findings sort by severity — worst first.
          </p>
          <pre className="mt-6 overflow-x-auto border border-[color:var(--color-hair)] bg-[color:var(--color-ink-900)] p-5 font-mono text-[12.5px] leading-relaxed text-[color:var(--color-paper-100)]">
{`kelp v0.2.1  ·  scanning .  ·  214 files walked

CRITICAL  src/lib/db.ts:14      Supabase service_role key   (eyJh…FAKE)
HIGH      src/api/orders.ts:3   Stripe live secret          (sk_l…KLLL)
MEDIUM    supabase/config.toml  get-order · verify_jwt=false

3 findings  ·  1 critical, 1 high, 1 medium  ·  0.4s`}
          </pre>
          <div className="mt-4 grid gap-2 font-mono text-[12.5px] leading-relaxed text-[color:var(--color-paper-300)]">
            <div><span className="text-[color:var(--color-signal-dim)]">exit 0</span> — clean, no findings above the gate</div>
            <div><span className="text-[color:var(--color-signal-dim)]">exit 1</span> — at least one finding above the gate</div>
            <div><span className="text-[color:var(--color-signal-dim)]">exit 2</span> — scan itself failed (bad path, unreadable target)</div>
          </div>
          <p className="mt-6 text-[13.5px] leading-[1.6] text-[color:var(--color-paper-400)]">
            Secret values never leave the scanner boundary — only a masked preview
            (<code className="font-mono text-[color:var(--color-paper-100)]">sk_l…KLLL</code>) reaches
            your terminal. Safe to pipe into a public log.
          </p>
        </section>

        {/* ── STEP 3 ─────────────────────────────────────────────────── */}
        <section className="mt-16">
          <StepLabel n="03" title="Wire it into CI" />
          <p className="mt-4 text-[14.5px] leading-[1.65] text-[color:var(--color-paper-300)]">
            The CLI is enough to catch things locally. For pull-request gating, add
            the GitHub Action to your repo — same engine, and it comments the
            verdict on the PR:
          </p>
          <pre className="mt-6 overflow-x-auto border border-[color:var(--color-hair)] bg-[color:var(--color-ink-900)] p-5 font-mono text-[12.5px] leading-relaxed text-[color:var(--color-paper-100)]">
{`# .github/workflows/kelp-check.yml
name: kelp/check
on:
  pull_request:
    branches: [main]
permissions:
  contents: read
  pull-requests: read
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: kelp-security/kelp-action@v1`}
          </pre>
          <p className="mt-6 text-[13.5px] leading-[1.6] text-[color:var(--color-paper-400)]">
            No secrets to configure. The Action verifies the workflow's own
            <Code>GITHUB_TOKEN</Code> and reports back to Kelp.
          </p>
        </section>

        {/* ── NEXT ────────────────────────────────────────────────────── */}
        <section className="mt-20 border-t border-[color:var(--color-hair)] pt-10">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--color-paper-500)]">
            Next
          </h2>
          <ul className="mt-6 divide-y divide-[color:var(--color-hair)] border-y border-[color:var(--color-hair)]">
            <NextLink
              href="/docs/action"
              title="GitHub Action, in depth"
              body="Inputs, outputs, required-status-check setup, troubleshooting."
            />
            <NextLink
              href="https://github.com/Mic52M/kelp/blob/master/docs/CLI.md"
              external
              title="CLI reference"
              body="Every flag, the JSON schema, exit codes, colour behaviour."
            />
            <NextLink
              href="https://github.com/Mic52M/kelp/blob/master/CONTRIBUTING.md"
              external
              title="Add a new detection"
              body="The test-first walkthrough for shipping a new secret pattern or class."
            />
          </ul>
        </section>

        <div className="mt-16 border-t border-[color:var(--color-hair)] pt-6">
          <Link
            href="/docs"
            className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)] transition-colors hover:text-[color:var(--color-paper-100)]"
          >
            ← All docs
          </Link>
        </div>
      </div>
    </main>
  );
}

function StepLabel({ n, title }: { n: string; title: string }) {
  return (
    <div className="flex items-baseline gap-4">
      <span className="font-mono tabular text-[13px] uppercase tracking-[0.18em] text-[color:var(--color-signal-dim)]">
        {n}
      </span>
      <h2 className="font-display text-[26px] leading-[1.15] text-[color:var(--color-paper-50)]">
        {title}
      </h2>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="font-mono text-[13.5px] text-[color:var(--color-paper-100)]">
      {" "}
      {children}{" "}
    </code>
  );
}

function NextLink({
  href,
  title,
  body,
  external,
}: {
  href: string;
  title: string;
  body: string;
  external?: boolean;
}) {
  const inner = (
    <div className="grid grid-cols-1 gap-1 py-5 lg:grid-cols-12 lg:gap-8">
      <div className="lg:col-span-4">
        <h3 className="font-display text-[18px] leading-[1.2] text-[color:var(--color-paper-50)]">
          {title} {external ? "↗" : "→"}
        </h3>
      </div>
      <p className="text-[13.5px] leading-[1.6] text-[color:var(--color-paper-300)] lg:col-span-8">
        {body}
      </p>
    </div>
  );
  return (
    <li>
      {external ? (
        <a href={href} target="_blank" rel="noreferrer noopener" className="block transition-colors hover:bg-[color:var(--color-ink-900)]/40">
          {inner}
        </a>
      ) : (
        <Link href={href} className="block transition-colors hover:bg-[color:var(--color-ink-900)]/40">
          {inner}
        </Link>
      )}
    </li>
  );
}
