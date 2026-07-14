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
  registerGithubInstallation,
  listOrgInstallationIds,
  type RepoOption,
  type SupabaseProjectInfo,
} from "@kelp/worker";
import { track, identityForUser } from "@/lib/analytics";

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
  { ok: true; repos: RepoOption[]; hasInstallation: boolean } | { ok: false; error: string }
> {
  try {
    const { orgId } = await requireOrg();
    let repos = await listReposForOrg(orgId);
    let hasInstallation = repos.length > 0;

    // Auto-attribution fallback (#46). When the user signed in via GitHub
    // OAuth the App may already be installed on one of their accounts, but
    // the OAuth callback might not have caught it (Supabase-cached
    // provider_token missing, transient GitHub error, etc.). Rather than
    // send the user through the install flow again, try to detect an
    // existing install via /user/installations using the session's
    // provider_token and register it silently. Then re-query repos.
    if (repos.length === 0) {
      const attributed = await tryAttributeFromSession(orgId);
      if (attributed) {
        hasInstallation = true;
        repos = await listReposForOrg(orgId);
      }
    }

    // hasInstallation stays true even when repos is empty — the caller uses
    // it to decide "skip the install CTA" vs "show install CTA". A user who
    // installed the App on an account with zero repos must still land on the
    // repo view (which prompts them to grant repo access), not on the CTA.
    // Since 0003 the source of truth for org installs is the
    // github_installations table (not orgs.github_installation_id, which the
    // register path stopped writing to). A non-empty result here means "an
    // install exists for this org, even if it currently exposes 0 repos".
    if (!hasInstallation) {
      const installIds = await listOrgInstallationIds(orgId);
      hasInstallation = installIds.length > 0;
    }

    return { ok: true, repos, hasInstallation };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not list repositories" };
  }
}

/** Attempt to attribute an existing GitHub App installation to `orgId`
 *  using the session's OAuth provider_token. Returns true when an install
 *  was successfully registered; false on any signal that no install exists
 *  or the token can't reach the API. Never throws — this is a best-effort
 *  auto-detect fired from a click handler. */
async function tryAttributeFromSession(orgId: string): Promise<boolean> {
  try {
    const supabase = await getServerSupabase();
    const { data: sessionData } = await supabase.auth.getSession();
    const providerToken = sessionData?.session?.provider_token;
    if (!providerToken) return false;

    const appIdRaw = process.env.GITHUB_APP_ID;
    const kelpAppId = appIdRaw ? Number(appIdRaw) : NaN;
    if (!Number.isFinite(kelpAppId)) return false;

    const res = await fetch("https://api.github.com/user/installations?per_page=100", {
      headers: {
        Authorization: `Bearer ${providerToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { installations?: Array<{ id: number; app_id: number }> };
    const ours = (body.installations ?? []).find((i) => i.app_id === kelpAppId);
    if (!ours) return false;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    await registerGithubInstallation({
      orgId,
      installationId: ours.id,
      connectedBy: user?.id ?? null,
    });
    return true;
  } catch (e) {
    console.warn(
      "tryAttributeFromSession failed:",
      e instanceof Error ? e.message : e,
    );
    return false;
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

  // Product analytics (#34): project.created + github_installed. The GitHub
  // App install itself happens off-site via the OAuth roundtrip; we mark it
  // fired here because reaching this action means the app installation was
  // committed to the org's row (installationId is present).
  const supabaseForIdent = await getServerSupabase();
  const { data: authData } = await supabaseForIdent.auth.getUser();
  const ident = identityForUser(authData.user ?? null);
  if (ident && projectId) {
    track(ident.distinctId, "project.created", {
      projectId,
      hasRepo: !!input.repoFullName,
      org_id: orgId,
    });
    if (input.installationId != null) {
      track(ident.distinctId, "github_installed", { installationId: input.installationId });
    }
  }

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
