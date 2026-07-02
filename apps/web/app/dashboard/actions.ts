"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { ensureTenant } from "@/lib/tenant";
import { enqueueScanForProject } from "@kelp/worker";

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
  revalidatePath("/dashboard");
}
