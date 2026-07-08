"use client";

// Repo-first onboarding. Connecting a project just links a GitHub repository —
// no API-key prompts. Kelp reads the repo, auto-detects the Supabase backend
// (URL + anon key + schema, even for Lovable Cloud), and sends the user to
// Configuration to finish (test accounts + consent). Everything credential-
// related now lives in Configuration, not here.

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
    // On success the action redirects to Configuration; only errors return here.
    setSubmitting(false);
    setSubmitError(res.error);
  }

  const filteredRepos = (repos ?? []).filter((r) =>
    r.fullName.toLowerCase().includes(repoFilter.toLowerCase()),
  );

  return (
    <div className="relative min-h-screen">
      <div className="aurora" />
      <header className="relative z-10 mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
        <Link href="/">
          <Logo />
        </Link>
        <span className="text-sm text-fog-400">Connect a project</span>
      </header>

      <main className="relative z-10 mx-auto max-w-3xl px-6 pb-24">
        <div className="glass rounded-2xl p-7">
          <div className="animate-rise">
            <h1 className="text-xl font-semibold">Connect a repository</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-fog-300">
              Pick the repo of the app you want to secure. Kelp reads the code to
              map your backend — it auto-detects Supabase (including Lovable
              Cloud) from the source. You'll finish setup in Configuration; no
              API keys needed here.
            </p>

            <div className="mt-6">
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
                <p className="mt-3 rounded-lg border border-aqua-600/40 bg-aqua-500/[0.08] px-3 py-2 text-xs text-aqua-300">
                  {installNote}
                </p>
              )}
              {repoError && <ErrorNote>{repoError}</ErrorNote>}

              {repos && (
                <>
                  <input
                    value={repoFilter}
                    onChange={(e) => setRepoFilter(e.target.value)}
                    placeholder={`Filter ${repos.length} repositories…`}
                    className="mb-2 w-full rounded-lg border border-line bg-ink-900 px-3.5 py-2 text-sm outline-none focus:border-aqua-600/60"
                  />
                  <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
                    {filteredRepos.map((r) => (
                      <button
                        key={r.fullName}
                        onClick={() => setSelectedRepo(selectedRepo?.fullName === r.fullName ? null : r)}
                        className={`flex w-full items-center justify-between rounded-lg border px-3.5 py-2.5 text-left text-sm transition-colors ${
                          selectedRepo?.fullName === r.fullName
                            ? "border-aqua-600/50 bg-aqua-500/10 text-fog-50"
                            : "border-line bg-ink-900/50 text-fog-300 hover:border-line hover:bg-white/[0.02]"
                        }`}
                      >
                        <span className="truncate font-mono">{r.fullName}</span>
                        {selectedRepo?.fullName === r.fullName && <span className="text-aqua-400">✓</span>}
                      </button>
                    ))}
                    {filteredRepos.length === 0 && (
                      <p className="px-1 py-4 text-sm text-fog-500">No repositories match.</p>
                    )}
                    {repos.length === 0 && (
                      <div className="px-1 py-4 text-sm text-fog-500">
                        No repositories yet.{" "}
                        <button onClick={startInstall} className="text-aqua-400 hover:text-aqua-300">
                          Install the Kelp GitHub App
                        </button>{" "}
                        and grant it access to a repo.
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {submitError && <ErrorNote>{submitError}</ErrorNote>}

            <div className="mt-7 flex items-center justify-between border-t border-line/70 pt-5">
              <Link href="/dashboard" className="text-sm text-fog-400 hover:text-fog-200">
                Skip for now
              </Link>
              <Button onClick={connect} disabled={!selectedRepo || submitting} size="lg">
                {submitting ? "Connecting…" : "Connect & continue"}
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 rounded-lg border border-[color:var(--color-crit)]/30 bg-[color:var(--color-crit)]/10 px-3 py-2 text-xs text-[color:var(--color-crit)]">
      {children}
    </p>
  );
}
