"use server";

import { revalidatePath } from "next/cache";
import { analyzeAndStoreBackendReport, loadBackendReport } from "@kelp/worker";
import { getServerSupabase } from "@/lib/supabase/server";

const REANALYZE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * On-demand trigger for the backend analyzer. Called by AnalyzingCard when
 * a project has no BackendReport yet. Runs the full hybrid analyzer +
 * persists to projects.backend_report. Ownership gated via RLS-scoped
 * SELECT before invoking the worker.
 */
/**
 * On-demand trigger for the backend analyzer.
 *
 * Two entry points share this action:
 *   · `mode: "auto"` — called by AnalyzingCard when there's no report yet.
 *     No cooldown; a project without a report has nothing to protect.
 *   · `mode: "manual"` — user clicked "Re-analyze". Enforces a 24h cooldown
 *     from the last `analyzedAt` so repeat clicks don't burn cost.
 *
 * Ownership always gated via RLS-scoped SELECT before hitting the worker.
 */
export async function runBackendAnalyzerAction(
  projectId: string,
  mode: "auto" | "manual" = "auto",
): Promise<
  { ok: true } | { ok: false; message: string; nextAvailableAt?: string }
> {
  const supabase = await getServerSupabase();

  const { data: project } = await supabase
    .from("projects")
    .select("id, org_id, github_repo_full_name, github_installation_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, message: "Project not found." };
  const p = project as {
    id: string;
    org_id: string;
    github_repo_full_name: string | null;
    github_installation_id: number | null;
  };
  if (!p.github_repo_full_name || p.github_installation_id == null) {
    return {
      ok: false,
      message:
        "This project isn't connected to a GitHub repo yet. Re-connect it via onboarding.",
    };
  }

  if (mode === "manual") {
    const existing = await loadBackendReport(p.id).catch(() => null);
    if (existing) {
      const last = new Date(existing.analyzedAt).getTime();
      const elapsed = Date.now() - last;
      if (elapsed < REANALYZE_COOLDOWN_MS) {
        const nextAvailable = new Date(last + REANALYZE_COOLDOWN_MS);
        return {
          ok: false,
          message: `Re-analyze is available once every 24 hours. Next available ${nextAvailable.toISOString()}.`,
          nextAvailableAt: nextAvailable.toISOString(),
        };
      }
    }
  }

  try {
    await analyzeAndStoreBackendReport({
      orgId: p.org_id,
      projectId: p.id,
      repoFullName: p.github_repo_full_name,
      installationId: p.github_installation_id,
    });
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Analyzer failed.",
    };
  }
  revalidatePath("/dashboard/configuration");
  revalidatePath("/dashboard");
  return { ok: true };
}
