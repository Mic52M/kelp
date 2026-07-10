"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { ensureTenant } from "@/lib/tenant";
import {
  listReposForOrg,
  listSupabaseProjects,
  createProjectAndEnqueueScan,
  detectAndStoreSupabaseBackend,
  analyzeAndStoreBackendReport,
  getGithubInstallUrl,
  drainScans,
  type RepoOption,
  type SupabaseProjectInfo,
} from "@kelp/worker";

/** Translate raw engine/DB errors into calm, human messages. */
function friendlyError(raw: string): string {
  if (/duplicate key|already/i.test(raw)) return "That project is already connected — re-scan it from your dashboard.";
  if (/rate limit|secondary/i.test(raw)) return "GitHub is rate-limiting us right now. Please try again in a minute.";
  return "Something went wrong connecting the repository. Please try again.";
}

async function requireOrg(): Promise<{ orgId: string }> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) throw new Error("Not signed in");
  return ensureTenant({ id: user.id, email: user.email });
}

export async function getGithubReposAction(): Promise<
  { ok: true; repos: RepoOption[] } | { ok: false; error: string }
> {
  try {
    const { orgId } = await requireOrg();
    return { ok: true, repos: await listReposForOrg(orgId) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not list repositories" };
  }
}

/** Signed URL to install the Kelp GitHub App for the current org. */
export async function startGithubInstallAction(): Promise<
  { ok: true; url: string } | { ok: false; error: string }
> {
  try {
    const { orgId } = await requireOrg();
    return { ok: true, url: await getGithubInstallUrl(orgId) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not start GitHub install" };
  }
}

export async function getSupabaseProjectsAction(
  token: string,
): Promise<{ ok: true; projects: SupabaseProjectInfo[] } | { ok: false; error: string }> {
  try {
    await requireOrg();
    const projects = await listSupabaseProjects(token.trim());
    return { ok: true, projects };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not list projects" };
  }
}

/**
 * Connect a repository (repo-first onboarding). Kelp links the repo, runs the
 * first secret scan, and sends the user to Configuration to finish setup —
 * where the Supabase backend is auto-detected from the repo and the user only
 * adds the two test accounts. No API-key prompt during connect (issue: the old
 * flow asked for a Supabase Management token here; that now lives in
 * Configuration, and is optional thanks to repo auto-detection).
 */
export async function connectAndScanAction(input: {
  projectName: string;
  repoFullName: string | null;
  installationId: number | null;
}): Promise<{ ok: false; error: string }> {
  const { orgId } = await requireOrg();

  if (!input.repoFullName) {
    return { ok: false, error: "Pick a repository to connect." };
  }

  let error: string | null = null;
  let projectId: string | null = null;
  try {
    const res = await createProjectAndEnqueueScan({
      orgId,
      name: input.projectName || input.repoFullName || "Project",
      repoFullName: input.repoFullName,
      installationId: input.installationId,
      supabaseRef: null,
      supabaseToken: null,
      classes: ["secret"],
    });
    projectId = res.projectId;
  } catch (e) {
    if (e instanceof Error && e.name === "PlanLimitError") {
      error = e.message;
    } else {
      error = friendlyError(e instanceof Error ? e.message : "The scan could not be started.");
    }
  }
  if (error) return { ok: false, error };

  // Auto-detect the Supabase backend from the repo (URL/ref + public anon key)
  // and persist it, so Configuration shows it as detected and the user never
  // has to paste it. Best-effort + in the background — a detection miss just
  // leaves the fields for manual entry.
  const pid = projectId;
  const repo = input.repoFullName;
  const inst = input.installationId;
  after(async () => {
    if (pid && repo && inst != null) {
      // Full hybrid analyzer: deterministic detection + LLM interpretation +
      // anti-fabrication gate. Persists the whole BackendReport to
      // projects.backend_report AND seeds the legacy fields (ref, anon key)
      // when Supabase is detected. Falls back to deterministic-only on any
      // failure — never blocks onboarding.
      await analyzeAndStoreBackendReport({
        orgId,
        projectId: pid,
        repoFullName: repo,
        installationId: inst,
      }).catch((e) =>
        console.warn("backend analyzer failed:", e instanceof Error ? e.message : e),
      );
    }
    await drainScans().catch((e) => console.error("scan processing failed:", e));
  });
  // Land in Configuration to finish setup (test accounts, consent) — the
  // Supabase backend is auto-detected from the repo there.
  redirect("/dashboard/configuration");
}
