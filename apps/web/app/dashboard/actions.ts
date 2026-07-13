"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { ensureTenant } from "@/lib/tenant";
import { PlanLimitError } from "@kelp/core";
import { enqueueScanForProject, drainScans, expireStuckScans } from "@kelp/worker";
import { track, identityForUser } from "@/lib/analytics";

/** Re-run the scan for a project the signed-in user owns. */
export async function rescanAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return;

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return;

  // Ownership check via RLS: the user can only see their org's projects.
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return;

  const { orgId } = await ensureTenant({ id: user.id, email: user.email });
  await enqueueScanForProject({ orgId, projectId, classes: ["secret", "rls"], trigger: "manual" });
  const ident = identityForUser(user);
  if (ident) track(ident.distinctId, "scan.started", { projectId, mode: "passive", org_id: orgId });
  after(() => drainScans().catch((e) => console.error("scan processing failed:", e)));
  revalidatePath("/dashboard");
}

export type ActivePentestStartState = { ok: boolean; message: string } | null;

/**
 * Enqueue an active-pentest scan (#27). Gated: plan tier must allow it (#17),
 * project must have consent v2 + app_base_url — pre-checked by the button on
 * the dashboard but the worker re-enforces every gate before spending money.
 * Failures surface as a friendly banner instead of a stack trace.
 */
export async function startActivePentestAction(
  _prev: ActivePentestStartState,
  formData: FormData,
): Promise<ActivePentestStartState> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { ok: false, message: "Pick a project." };

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, message: "You're signed out." };

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, message: "That project no longer exists." };

  const { orgId } = await ensureTenant({ id: user.id, email: user.email });
  try {
    await enqueueScanForProject({
      orgId,
      projectId,
      // Every specialist's DB class — RLS-deep reuses 'rls', weak-crypto reuses 'auth'.
      classes: ["bola", "auth", "injection", "ssrf", "exposure", "rls"],
      trigger: "manual",
      mode: "active_pentest",
    });
  } catch (e) {
    if (e instanceof PlanLimitError) {
      return { ok: false, message: e.message };
    }
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Could not start the pen test.",
    };
  }
  const ident = identityForUser(user);
  if (ident) track(ident.distinctId, "scan.started", { projectId, mode: "active_pentest", org_id: orgId });
  after(() => drainScans().catch((err) => console.error("active-pentest run failed:", err)));
  revalidatePath("/dashboard");
  return { ok: true, message: "Active pen test started — findings will appear as specialists finish." };
}

/**
 * Manual reset for a scan the user believes is stuck (#8). Aggressive TTL (0
 * minutes) — the user only sees this control when the automatic self-heal
 * (loadDashboard → expireStuckScans 20m) hasn't kicked in yet, so we trust
 * their call. Idempotent: no-op when no in-flight scan exists.
 */
export async function resetStuckScanAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return;

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return;

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return;

  await expireStuckScans(projectId, 0);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/projects");
}
