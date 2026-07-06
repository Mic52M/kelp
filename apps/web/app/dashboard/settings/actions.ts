"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { ensureTenant } from "@/lib/tenant";
import { CONSENT_V2_TEXT, CONSENT_VERSION_LATEST } from "@kelp/core";
import {
  listSupabaseProjects,
  putCredential,
  enqueueScanForProject,
  drainScans,
  saveActiveTestConsent,
  revokeActiveTestConsent,
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

export type ConsentActionState = { ok: boolean; message: string } | null;

/**
 * Grant v2 active-testing consent for a project (issue #24). The multi-specialist
 * campaign refuses to run without a non-revoked v2 row for the project. The
 * verbatim CONSENT_V2_TEXT is stored on the row for audit — if we change the
 * copy we bump the version and re-prompt.
 */
export async function acceptV2ConsentAction(
  _prev: ConsentActionState,
  formData: FormData,
): Promise<ConsentActionState> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { ok: false, message: "Pick a project." };

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, message: "You're signed out." };

  // RLS ensures the user can only see their org's projects — this scopes the write.
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, message: "That project no longer exists." };

  const { orgId } = await ensureTenant({ id: user.id, email: user.email });
  await saveActiveTestConsent({
    orgId,
    projectId,
    consentText: CONSENT_V2_TEXT,
    consentVersion: CONSENT_VERSION_LATEST,
    consentedBy: user.id,
  });

  revalidatePath("/dashboard/settings");
  return { ok: true, message: "Active-testing consent granted." };
}

/** Revoke the active-testing consent for a project. Effective immediately —
 *  further campaigns will refuse until re-granted. */
export async function revokeV2ConsentAction(
  _prev: ConsentActionState,
  formData: FormData,
): Promise<ConsentActionState> {
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

  await revokeActiveTestConsent({ projectId, revokedBy: user.id });

  revalidatePath("/dashboard/settings");
  return { ok: true, message: "Active-testing consent revoked." };
}
