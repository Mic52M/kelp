"use server";

import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { ensureTenant } from "@/lib/tenant";
import {
  listInstallationRepos,
  listSupabaseProjects,
  createProjectAndScan,
  type SupabaseProjectInfo,
} from "@kelp/worker";

/** Translate raw engine/DB errors into calm, human messages. */
function friendlyError(raw: string): string {
  if (/duplicate key|already/i.test(raw)) return "That project is already connected — re-scan it from your dashboard.";
  if (/rate limit|secondary/i.test(raw)) return "GitHub is rate-limiting us right now. Please try again in a minute.";
  if (/401|unauthor|token/i.test(raw)) return "A credential was rejected. Double-check your Supabase token.";
  return "Something went wrong running the scan. Please try again.";
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
  { ok: true; repos: string[] } | { ok: false; error: string }
> {
  try {
    await requireOrg();
    return { ok: true, repos: await listInstallationRepos() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not list repositories" };
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

export async function connectAndScanAction(input: {
  projectName: string;
  repoFullName: string | null;
  supabaseRef: string | null;
  supabaseToken: string | null;
}): Promise<{ ok: false; error: string }> {
  const { orgId } = await requireOrg();

  const classes: Array<"secret" | "rls"> = [];
  if (input.repoFullName) classes.push("secret");
  if (input.supabaseRef) classes.push("rls");
  if (classes.length === 0) {
    return { ok: false, error: "Connect at least a repository or a Supabase project." };
  }

  let error: string | null = null;
  try {
    await createProjectAndScan({
      orgId,
      name: input.projectName || input.repoFullName || input.supabaseRef || "Project",
      repoFullName: input.repoFullName,
      supabaseRef: input.supabaseRef,
      supabaseToken: input.supabaseToken,
      classes,
    });
  } catch (e) {
    error = friendlyError(e instanceof Error ? e.message : "The scan failed to run.");
  }
  if (error) return { ok: false, error };

  redirect("/dashboard");
}
