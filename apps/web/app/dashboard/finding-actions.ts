"use server";

import { revalidatePath } from "next/cache";
import { openSecretFixPr } from "@kelp/worker";
import { getServerSupabase, getAdminSupabase } from "@/lib/supabase/server";

export interface FixPrState {
  url?: string;
  error?: string;
}

/** Open a real GitHub PR that moves the exposed secret to an env var. */
export async function openFixPr(_prev: FixPrState, formData: FormData): Promise<FixPrState> {
  const id = String(formData.get("findingId") ?? "");
  if (!id) return { error: "Missing finding." };

  const supabase = await getServerSupabase();
  // Ownership via RLS: the user can only SELECT findings in their orgs.
  const { data: owned } = await supabase.from("findings").select("id").eq("id", id).maybeSingle();
  if (!owned) return { error: "Finding not found." };

  const { data: auth } = await supabase.auth.getUser();
  const result = await openSecretFixPr(id, auth.user?.id);
  if (!result.ok) return { error: result.error };

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/findings");
  return { url: result.url };
}

/** Mark a finding as resolved (the user fixed it). */
export async function markResolvedFinding(formData: FormData): Promise<void> {
  await updateFindingStatus(String(formData.get("findingId") ?? ""), "resolved");
}

/**
 * Report a finding as a false positive. For now this HARD-DELETES the row —
 * the previous soft-dismiss behavior left the finding visible on the
 * dashboard (the active-issues filter only excludes `resolved`), so the
 * button looked broken. Deleting is the honest UX: click → gone.
 *
 * `finding_feedback` had a FK on findings(id) with `on delete cascade`, so
 * any prior feedback rows drop with the finding. We skip inserting a fresh
 * feedback row on delete — the detection-tuning loop is a future feature
 * (issue #29 follow-up); when we bring it back it will read from a
 * separate telemetry table, not from cascaded rows.
 */
export async function reportFalsePositive(formData: FormData): Promise<void> {
  const id = String(formData.get("findingId") ?? "");
  if (!id) return;

  const supabase = await getServerSupabase();
  // Ownership via RLS: the user can only SELECT findings in their orgs.
  const { data: owned } = await supabase.from("findings").select("id").eq("id", id).maybeSingle();
  if (!owned) return;

  await getAdminSupabase().from("findings").delete().eq("id", id);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/findings");
}

async function updateFindingStatus(id: string, status: "resolved" | "dismissed"): Promise<void> {
  if (!id) return;
  const supabase = await getServerSupabase();
  const { data: owned } = await supabase.from("findings").select("id").eq("id", id).maybeSingle();
  if (!owned) return;
  // The browser role has no UPDATE policy on findings, so mutate with the admin
  // client (service role) after the ownership check.
  await getAdminSupabase().from("findings").update({ status }).eq("id", id);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/findings");
}
