"use client";

// Repo-first onboarding. Connecting a project just links a GitHub repository —
// no API-key prompts. Kelp reads the repo, auto-detects the Supabase backend
// (URL + anon key + schema, even for Lovable Cloud), and sends the user to
// Configuration to finish (test accounts + consent).

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Logo } from "@/components/Logo";
import {
  getGithubReposAction,
  startGithubInstallAction,
  connectAndScanAction,
} from "./actions";
import type { RepoOption } from "@kelp/worker";

export default function Onboarding() {
  const [repos, setRepos] = useState<RepoOption[] | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installNote, setInstallNote] = useState<string | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<RepoOption | null>(null);
  const [repoFilter, setRepoFilter] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function loadRepos() {
    setLoadingRepos(true);
    setRepoError(null);
    const res = await getGithubReposAction();
    setLoadingRepos(false);
    if (res.ok) setRepos(res.repos);
    else setRepoError(res.error);
  }

  async function startInstall() {
    setInstalling(true);
    setRepoError(null);
    const res = await startGithubInstallAction();
    if (res.ok) window.location.href = res.url;
    else {
      setInstalling(false);
      setRepoError(res.error);
    }
  }

  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("github");
    if (!status) return;
    window.history.replaceState(null, "", "/onboarding");
    if (status === "connected") {
      setInstallNote("GitHub App installed — loading your repositories…");
      void loadRepos();
    } else if (status === "pending") {
      setInstallNote(
        "Install requested. An owner of that GitHub organization needs to approve it, then come back and load your repositories.",
      );
    } else if (status === "error") {
      setRepoError("We couldn't complete the GitHub install. Please try again.");
    }
  }, []);

  async function connect() {
    if (!selectedRepo) return;
    setSubmitting(true);
    setSubmitError(null);
    const res = await connectAndScanAction({
      projectName: selectedRepo.fullName.split("/")[1] ?? "Project",
      repoFullName: selectedRepo.fullName,
      installationId: selectedRepo.installationId ?? null,
    });
    setSubmitting(false);
    setSubmitError(res.error);
  }

  const filteredRepos = (repos ?? []).filter((r) =>
    r.fullName.toLowerCase().includes(repoFilter.toLowerCase()),
  );

  return (
    <div className="relative min-h-screen">
      <div className="pointer-events-none absolute inset-y-0 left-[max(1.5rem,calc(50%-560px))] hidden xl:block">
        <div className="filament" />
      </div>

      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-8">
        <Link href="/" aria-label="Kelp home">
          <Logo />
        </Link>
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
          Connect a project
        </span>
      </header>

      <div className="mx-auto max-w-3xl px-6">
        <div className="h-px w-full bg-[color:var(--color-hair)]" />
      </div>

      <main className="mx-auto max-w-3xl px-6 pb-24 pt-16">
        <div className="eyebrow flex items-center gap-3">
          <span className="h-px w-6 bg-[color:var(--color-hair-strong)]" aria-hidden />
          <span>§ Onboarding · Step 01</span>
        </div>
        <h1 className="font-display mt-6 text-[44px] leading-[1.05] text-[color:var(--color-paper-50)] sm:text-[52px]">
          Connect a repository.
        </h1>
        <p className="mt-5 max-w-xl text-[15px] leading-[1.65] text-[color:var(--color-paper-300)]">
          Pick the repo of the app you want to secure. Kelp reads the code to map your backend —
          it auto-detects Supabase (including Lovable Cloud) from the source. You'll finish setup
          in Configuration; no API keys needed here.
        </p>

        <div className="mt-12 border border-[color:var(--color-hair)] p-8">
          {!repos && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button onClick={startInstall} disabled={installing} size="lg">
                {installing ? "Redirecting to GitHub…" : "Install the Kelp GitHub App"}
              </Button>
              <Button onClick={loadRepos} disabled={loadingRepos} variant="tertiary">
                {loadingRepos ? "Loading…" : "Already installed? Load my repositories"}
              </Button>
            </div>
          )}
          {installNote && (
            <p
              className="mt-4 border-l px-4 py-2.5 font-mono text-[12px] leading-relaxed"
              style={{ borderColor: "var(--color-signal-dim)", color: "var(--color-signal)" }}
            >
              {installNote}
            </p>
          )}
          {repoError && <ErrorNote>{repoError}</ErrorNote>}

          {repos && (
            <>
              <div className="mb-4 font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
                Repositories
              </div>
              <input
                value={repoFilter}
                onChange={(e) => setRepoFilter(e.target.value)}
                placeholder={`Filter ${repos.length} repositories…`}
                className="mb-3 w-full border-b border-[color:var(--color-hair)] bg-transparent px-0 py-2 text-[14px] text-[color:var(--color-paper-50)] outline-none transition-colors focus:border-[color:var(--color-signal)] placeholder:text-[color:var(--color-paper-500)]"
              />
              <div className="max-h-72 divide-y divide-[color:var(--color-hair)] overflow-y-auto border-y border-[color:var(--color-hair)]">
                {filteredRepos.map((r) => {
                  const isSelected = selectedRepo?.fullName === r.fullName;
                  return (
                    <button
                      key={r.fullName}
                      onClick={() =>
                        setSelectedRepo(isSelected ? null : r)
                      }
                      className="flex w-full items-center justify-between px-3 py-2.5 text-left font-mono text-[13px] transition-colors hover:bg-[color:var(--color-ink-850)]"
                      style={{
                        color: isSelected ? "var(--color-paper-50)" : "var(--color-paper-300)",
                      }}
                    >
                      <span className="truncate">{r.fullName}</span>
                      {isSelected && (
                        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-signal)]">
                          Selected
                        </span>
                      )}
                    </button>
                  );
                })}
                {filteredRepos.length === 0 && (
                  <p className="px-3 py-4 font-mono text-[12px] text-[color:var(--color-paper-500)]">
                    No repositories match.
                  </p>
                )}
                {repos.length === 0 && (
                  <div className="px-3 py-4 font-mono text-[12px] text-[color:var(--color-paper-500)]">
                    No repositories yet.{" "}
                    <button
                      onClick={startInstall}
                      className="text-[color:var(--color-signal)] hover:text-[color:var(--color-paper-50)]"
                    >
                      Install the Kelp GitHub App
                    </button>{" "}
                    and grant it access to a repo.
                  </div>
                )}
              </div>
            </>
          )}

          {submitError && <ErrorNote>{submitError}</ErrorNote>}

          <div className="mt-8 flex items-center justify-between border-t border-[color:var(--color-hair)] pt-6">
            <Link
              href="/dashboard"
              className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)] transition-colors hover:text-[color:var(--color-paper-50)]"
            >
              Skip for now
            </Link>
            <Button onClick={connect} disabled={!selectedRepo || submitting} size="lg">
              {submitting ? "Connecting…" : "Connect & continue"}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mt-4 border-l px-4 py-2.5 font-mono text-[12px] leading-relaxed"
      style={{ borderColor: "var(--color-sev-crit)", color: "var(--color-sev-crit)" }}
    >
      {children}
    </p>
  );
}
