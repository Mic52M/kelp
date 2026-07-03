"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase, getAdminSupabase } from "@/lib/supabase/server";

/** Dismiss a finding the signed-in user owns (accepted risk / not applicable). */
export async function dismissFinding(formData: FormData): Promise<void> {
  const id = String(formData.get("findingId") ?? "");
  if (!id) return;

  const supabase = await getServerSupabase();
  // Ownership via RLS: the user can only SELECT findings in their orgs.
  const { data: owned } = await supabase.from("findings").select("id").eq("id", id).maybeSingle();
  if (!owned) return;

  // The browser role has no UPDATE policy on findings, so mutate with the admin
  // client (service role) after the ownership check.
  await getAdminSupabase().from("findings").update({ status: "dismissed" }).eq("id", id);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/findings");
}
