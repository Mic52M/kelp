"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { ensureTenant } from "@/lib/tenant";
import {
  listSupabaseProjects,
  putCredential,
  enqueueScanForProject,
  drainScans,
} from "@kelp/worker";

export type ReconnectState = { ok: boolean; message: string } | null;

/** Update the encrypted Supabase token for a project and re-scan it. */
export async function reconnectSupabaseAction(
  _prev: ReconnectState,
  formData: FormData,
): Promise<ReconnectState> {
  const projectId = String(formData.get("projectId") ?? "");
  const token = String(formData.get("token") ?? "").trim();
  if (!projectId || !token) return { ok: false, message: "Pick a project and paste a token." };

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, message: "You’re signed out." };

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, message: "That project no longer exists." };

  try {
    await listSupabaseProjects(token);
  } catch {
    return { ok: false, message: "Supabase rejected that token. Check it and try again." };
  }

  const { orgId } = await ensureTenant({ id: user.id, email: user.email });
  await putCredential(orgId, projectId, "supabase_management", token);
  await enqueueScanForProject({ orgId, projectId, classes: ["secret", "rls"], trigger: "manual" });
  after(() => drainScans().catch(() => {}));

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/settings");
  return { ok: true, message: "Reconnected — a fresh scan is running." };
}
