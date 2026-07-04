"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Logo } from "@/components/Logo";
import {
  getGithubReposAction,
  getSupabaseProjectsAction,
  startGithubInstallAction,
  connectAndScanAction,
} from "./actions";
import type { RepoOption, SupabaseProjectInfo } from "@kelp/worker";

const STEPS = ["Connect GitHub", "Connect Supabase", "Scan"] as const;

export default function Onboarding() {
  const [step, setStep] = useState(0);

  // GitHub
  const [repos, setRepos] = useState<RepoOption[] | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installNote, setInstallNote] = useState<string | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<RepoOption | null>(null);
  const [repoFilter, setRepoFilter] = useState("");

  // Supabase
  const [token, setToken] = useState("");
  const [projects, setProjects] = useState<SupabaseProjectInfo[] | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [sbError, setSbError] = useState<string | null>(null);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);

  // Submit
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
    if (res.ok) window.location.href = res.url; // leaves the app for GitHub
    else {
      setInstalling(false);
      setRepoError(res.error);
    }
  }

  // Handle the return from the GitHub install callback (?github=…).
  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("github");
    if (!status) return;
    window.history.replaceState(null, "", "/onboarding"); // clean the URL
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

  async function loadProjects() {
    if (!token.trim()) return;
    setLoadingProjects(true);
    setSbError(null);
    const res = await getSupabaseProjectsAction(token);
    setLoadingProjects(false);
    if (res.ok) setProjects(res.projects);
    else setSbError(res.error);
  }

  async function runScan() {
    setSubmitting(true);
    setSubmitError(null);
    const res = await connectAndScanAction({
      projectName:
        selectedRepo?.fullName.split("/")[1] ??
        projects?.find((p) => p.ref === selectedRef)?.name ??
        "Project",
      repoFullName: selectedRepo?.fullName ?? null,
      installationId: selectedRepo?.installationId ?? null,
      supabaseRef: selectedRef,
      supabaseToken: selectedRef ? token : null,
    });
    // On success the action redirects; only errors return here.
    setSubmitting(false);
    setSubmitError(res.error);
  }

  const canScan = Boolean(selectedRepo || selectedRef);
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
        <span className="text-sm text-fog-400">
          Step {step + 1} of {STEPS.length}
        </span>
      </header>

      <main className="relative z-10 mx-auto max-w-3xl px-6 pb-24">
        <div className="mb-10 flex items-center gap-2">
          {STEPS.map((label, i) => (
            <div key={label} className="flex flex-1 items-center gap-2">
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium ${
                  i < step
                    ? "border-aqua-600/50 bg-aqua-500/20 text-aqua-400"
                    : i === step
                      ? "border-aqua-500 bg-aqua-500 text-ink-950"
                      : "border-line bg-ink-800 text-fog-500"
                }`}
              >
                {i < step ? "✓" : i + 1}
              </div>
              <span className={`hidden text-xs sm:block ${i === step ? "text-fog-50" : "text-fog-500"}`}>
                {label}
              </span>
              {i < STEPS.length - 1 && <div className="h-px flex-1 bg-line" />}
            </div>
          ))}
        </div>

        <div className="glass rounded-2xl p-7">
          {step === 0 && (
            <Panel
              title="Connect a GitHub repository"
              subtitle="Kelp reads your code to find exposed secrets. Choose one repository the Kelp GitHub App can access. (Optional — you can scan Supabase alone.)"
            >
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
                  <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
                    {filteredRepos.map((r) => (
                      <button
                        key={r.fullName}
                        onClick={() =>
                          setSelectedRepo(selectedRepo?.fullName === r.fullName ? null : r)
                        }
                        className={`flex w-full items-center justify-between rounded-lg border px-3.5 py-2.5 text-left text-sm transition-colors ${
                          selectedRepo?.fullName === r.fullName
                            ? "border-aqua-600/50 bg-aqua-500/10 text-fog-50"
                            : "border-line bg-ink-900/50 text-fog-300 hover:border-line hover:bg-white/[0.02]"
                        }`}
                      >
                        <span className="truncate font-mono">{r.fullName}</span>
                        {selectedRepo?.fullName === r.fullName && (
                          <span className="text-aqua-400">✓</span>
                        )}
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
            </Panel>
          )}

          {step === 1 && (
            <Panel
              title="Connect your Supabase project"
              subtitle="Kelp reads your schema and RLS policies to find data anyone can access. Paste a Management API token, then pick the project to scan."
            >
              <label className="mb-1.5 block text-xs font-medium text-fog-400">
                Supabase Management API token
              </label>
              <div className="flex gap-2">
                <input
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  type="password"
                  placeholder="sbp_…"
                  className="w-full rounded-lg border border-line bg-ink-900 px-3.5 py-2.5 text-sm outline-none focus:border-aqua-600/60"
                />
                <Button
                  onClick={loadProjects}
                  disabled={loadingProjects || !token.trim()}
                  variant="secondary"
                  size="lg"
                  className="shrink-0"
                >
                  {loadingProjects ? "Loading…" : "Load projects"}
                </Button>
              </div>
              <p className="mt-2 text-xs text-fog-500">Stored encrypted. Read-only schema access.</p>
              {sbError && <ErrorNote>{sbError}</ErrorNote>}

              {projects && (
                <div className="mt-4 max-h-64 space-y-1 overflow-y-auto pr-1">
                  {projects.map((p) => (
                    <button
                      key={p.ref}
                      onClick={() => setSelectedRef(selectedRef === p.ref ? null : p.ref)}
                      className={`flex w-full items-center justify-between rounded-lg border px-3.5 py-2.5 text-left text-sm transition-colors ${
                        selectedRef === p.ref
                          ? "border-aqua-600/50 bg-aqua-500/10 text-fog-50"
                          : "border-line bg-ink-900/50 text-fog-300 hover:bg-white/[0.02]"
                      }`}
                    >
                      <span>
                        <span className="font-medium">{p.name}</span>
                        <span className="ml-2 font-mono text-xs text-fog-500">{p.ref}</span>
                        <span className="ml-2 text-xs text-fog-500">· {p.region}</span>
                      </span>
                      {selectedRef === p.ref ? (
                        <span className="text-aqua-400">✓</span>
                      ) : (
                        <span className="text-xs text-fog-500">{p.status}</span>
                      )}
                    </button>
                  ))}
                  {projects.length === 0 && (
                    <p className="px-1 py-4 text-sm text-fog-500">
                      This token has no projects.
                    </p>
                  )}
                </div>
              )}
            </Panel>
          )}

          {step === 2 && (
            <Panel
              title="Ready to scan"
              subtitle="Kelp will scan what you connected now. This runs immediately."
            >
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <span className={selectedRepo ? "text-aqua-400" : "text-fog-600"}>
                    {selectedRepo ? "✓" : "—"}
                  </span>
                  <span className="text-fog-300">
                    Secret scan{" "}
                    {selectedRepo ? (
                      <span className="font-mono text-fog-50">{selectedRepo.fullName}</span>
                    ) : (
                      "(no repository selected)"
                    )}
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className={selectedRef ? "text-aqua-400" : "text-fog-600"}>
                    {selectedRef ? "✓" : "—"}
                  </span>
                  <span className="text-fog-300">
                    RLS scan{" "}
                    {selectedRef ? (
                      <span className="font-mono text-fog-50">
                        {projects?.find((p) => p.ref === selectedRef)?.name ?? selectedRef}
                      </span>
                    ) : (
                      "(no Supabase project selected)"
                    )}
                  </span>
                </li>
              </ul>

              {!canScan && (
                <ErrorNote>Go back and connect a repository or a Supabase project first.</ErrorNote>
              )}
              {submitError && <ErrorNote>{submitError}</ErrorNote>}

              <Button
                onClick={runScan}
                disabled={!canScan || submitting}
                size="lg"
                className="mt-6"
              >
                {submitting ? "Scanning… this can take a moment" : "Connect & run scan"}
              </Button>
            </Panel>
          )}

          <div className="mt-7 flex items-center justify-between border-t border-line/70 pt-5">
            <Button
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0 || submitting}
              variant="tertiary"
            >
              Back
            </Button>
            {step < STEPS.length - 1 && (
              <Button onClick={() => setStep((s) => s + 1)}>Continue</Button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="animate-rise">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-fog-300">{subtitle}</p>
      <div className="mt-6">{children}</div>
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
