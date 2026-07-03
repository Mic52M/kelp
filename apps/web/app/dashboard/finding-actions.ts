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
