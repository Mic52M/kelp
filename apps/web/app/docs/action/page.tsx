// Public docs for the kelp/check GitHub Action (#36, option C).
//
// Anonymous — no auth. Copy-paste YAML snippet + required-check setup +
// troubleshooting. Reachable at /docs/action, linked from the dashboard
// PR-check panel and from the landing footer.

import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";

export const metadata: Metadata = {
  title: "kelp/check — GitHub Action · Kelp",
  description:
    "Add the kelp/check GitHub Action to your repository. Kelp scans every PR for new security findings and fails the check when critical or high issues are introduced.",
};

const ACTION_SLUG = process.env.KELP_ACTION_REPO ?? "Mic52M/kelp-action";
const ACTION_REF = process.env.KELP_ACTION_REF ?? "v1";

const WORKFLOW_SNIPPET = `name: kelp/check
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
      - uses: ${ACTION_SLUG}@${ACTION_REF}
`;

export default function ActionDocs() {
  return (
    <div className="relative min-h-screen">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-8">
        <Link href="/" aria-label="Kelp home">
          <Logo />
        </Link>
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
          Docs · GitHub Action
        </span>
      </header>

      <div className="mx-auto max-w-3xl px-6">
        <div className="h-px w-full bg-[color:var(--color-hair)]" />
      </div>

      <main className="mx-auto max-w-3xl px-6 pb-24 pt-16">
        <div className="eyebrow flex items-center gap-3">
          <span className="h-px w-6 bg-[color:var(--color-hair-strong)]" aria-hidden />
          <span>§ Docs · kelp/check</span>
        </div>
        <h1 className="font-display mt-6 text-[44px] leading-[1.05] text-[color:var(--color-paper-50)] sm:text-[52px]">
          kelp/check.
        </h1>
        <p className="mt-5 max-w-xl text-[15px] leading-[1.65] text-[color:var(--color-paper-300)]">
          Adds a required security check to your pull requests. Kelp scans the
          PR head commit for new critical or high findings against the base
          branch, posts one comment with the verdict, and fails the check when
          the PR introduces gating issues.
        </p>

        <section className="mt-14">
          <SectionHeader>Prerequisites</SectionHeader>
          <ol className="mt-5 list-decimal space-y-2 pl-6 text-[15px] leading-[1.65] text-[color:var(--color-paper-300)]">
            <li>
              Install the{" "}
              <a
                href="https://github.com/apps/kelp-security"
                target="_blank"
                rel="noreferrer noopener"
                className="text-[color:var(--color-signal)] hover:text-[color:var(--color-paper-50)]"
              >
                Kelp GitHub App
              </a>{" "}
              on your repo's org.
            </li>
            <li>
              Connect the repo at{" "}
              <Link
                href="/dashboard"
                className="text-[color:var(--color-signal)] hover:text-[color:var(--color-paper-50)]"
              >
                kelp.dev/dashboard
              </Link>
              .
            </li>
          </ol>
        </section>

        <section className="mt-14">
          <SectionHeader>Add the workflow</SectionHeader>
          <p className="mt-3 text-[15px] leading-[1.65] text-[color:var(--color-paper-300)]">
            When you connect a repo, Kelp opens a PR automatically that adds
            this file. If you prefer to add it by hand, or if you closed the
            auto-opened PR, drop this into{" "}
            <code className="font-mono text-[13px] text-[color:var(--color-paper-100)]">
              .github/workflows/kelp-check.yml
            </code>{" "}
            in your repo.
          </p>
          <YamlBlock text={WORKFLOW_SNIPPET} />
          <p className="mt-3 font-mono text-[12px] leading-relaxed text-[color:var(--color-paper-500)]">
            No API keys, no secrets. The workflow's ephemeral GITHUB_TOKEN
            authenticates the request to Kelp.
          </p>
        </section>

        <section className="mt-14">
          <SectionHeader>Make it a required check</SectionHeader>
          <p className="mt-3 text-[15px] leading-[1.65] text-[color:var(--color-paper-300)]">
            The workflow runs on every PR by default but doesn't block merges
            on its own. To gate merges through Kelp:
          </p>
          <ol className="mt-3 list-decimal space-y-2 pl-6 text-[15px] leading-[1.65] text-[color:var(--color-paper-300)]">
            <li>
              Open the first PR that triggers the workflow so GitHub registers
              it as a status check.
            </li>
            <li>
              Go to <strong>Settings → Branches → Branch protection rules</strong>{" "}
              for <code className="font-mono text-[13px]">main</code>.
            </li>
            <li>
              Enable <strong>"Require status checks to pass before merging"</strong>,
              search for <code className="font-mono text-[13px]">kelp/check</code>,
              and mark it as required.
            </li>
          </ol>
        </section>

        <section className="mt-14">
          <SectionHeader>Inputs</SectionHeader>
          <div className="mt-5 divide-y divide-[color:var(--color-hair)] border-y border-[color:var(--color-hair)]">
            <InputRow name="kelp-url" def="https://kelp.dev">
              Kelp API base URL. Override for staging or self-hosted deployments.
            </InputRow>
            <InputRow name="github-token" def="${{ github.token }}">
              Token used to authenticate the workflow's identity to Kelp. Defaults
              to the ephemeral workflow token — you shouldn't need to override.
            </InputRow>
            <InputRow name="fail-on" def="critical,high">
              Comma-separated severities that fail the check when introduced by
              the PR. Add <code className="font-mono">medium</code> or{" "}
              <code className="font-mono">low</code> to widen the gate.
            </InputRow>
            <InputRow name="poll-timeout-seconds" def="300">
              How long the Action waits for the scan to finish. Increase for
              large repos.
            </InputRow>
          </div>
        </section>

        <section className="mt-14">
          <SectionHeader>Troubleshooting</SectionHeader>
          <div className="mt-5 space-y-6">
            <Trouble title="repo_not_connected — check fails immediately">
              The repo isn't linked to a Kelp project yet. Sign in at{" "}
              <Link
                href="/dashboard"
                className="text-[color:var(--color-signal)] hover:text-[color:var(--color-paper-50)]"
              >
                kelp.dev/dashboard
              </Link>{" "}
              and connect it, then re-run the check.
            </Trouble>
            <Trouble title="invalid_github_token / repo_mismatch">
              Your workflow's <code className="font-mono">permissions:</code>{" "}
              block is missing <code className="font-mono">contents: read</code>.
              Add it and re-run.
            </Trouble>
            <Trouble title="Timed out after 300s">
              First scans on large repos can take longer. Bump{" "}
              <code className="font-mono">poll-timeout-seconds</code> to{" "}
              <code className="font-mono">"600"</code>.
            </Trouble>
            <Trouble title="No comment on the PR">
              Check that the Kelp GitHub App has{" "}
              <strong>Pull requests: write</strong> permission on your install.
              If you installed before this was added, accept the new permissions
              from GitHub.
            </Trouble>
          </div>
        </section>

        <div className="mt-16 border-t border-[color:var(--color-hair)] pt-6">
          <Link
            href="/dashboard"
            className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)] transition-colors hover:text-[color:var(--color-paper-50)]"
          >
            ← Back to dashboard
          </Link>
        </div>
      </main>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display text-[26px] leading-[1.15] text-[color:var(--color-paper-50)]">
      {children}
    </h2>
  );
}

function YamlBlock({ text }: { text: string }) {
  return (
    <pre className="mt-4 overflow-x-auto border border-[color:var(--color-hair)] bg-[color:var(--color-ink-850)] p-4 font-mono text-[12.5px] leading-relaxed text-[color:var(--color-paper-100)]">
      {text}
    </pre>
  );
}

function InputRow({
  name,
  def,
  children,
}: {
  name: string;
  def: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-1.5 py-4 lg:grid-cols-12">
      <div className="lg:col-span-3">
        <code className="font-mono text-[13px] text-[color:var(--color-paper-50)]">
          {name}
        </code>
        <div className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
          default: {def}
        </div>
      </div>
      <div className="text-[14px] leading-[1.6] text-[color:var(--color-paper-300)] lg:col-span-9">
        {children}
      </div>
    </div>
  );
}

function Trouble({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-l border-[color:var(--color-hair-strong)] pl-4">
      <div className="font-mono text-[12px] uppercase tracking-[0.14em] text-[color:var(--color-paper-100)]">
        {title}
      </div>
      <p className="mt-1.5 text-[14px] leading-[1.6] text-[color:var(--color-paper-300)]">
        {children}
      </p>
    </div>
  );
}
