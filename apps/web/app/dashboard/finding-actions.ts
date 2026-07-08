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
 * Report a finding as a false positive. Sets it to `dismissed` AND records a
 * feedback row (vuln class, rule, location, fingerprint — never any secret
 * value) so we can tune the detector. This is the precision feedback loop.
 */
export async function reportFalsePositive(formData: FormData): Promise<void> {
  const id = String(formData.get("findingId") ?? "");
  const note = String(formData.get("note") ?? "").slice(0, 500) || null;
  if (!id) return;

  const supabase = await getServerSupabase();
  // Ownership via RLS: the user can only SELECT findings in their orgs. Pull the
  // context we want to learn from in the same query.
  const { data: f } = await supabase
    .from("findings")
    .select("id, org_id, vuln_class, title, location, fingerprint, evidence")
    .eq("id", id)
    .maybeSingle();
  if (!f) return;

  const admin = getAdminSupabase();
  const { data: auth } = await supabase.auth.getUser();
  const ruleId = (f as { evidence?: { raw?: { ruleId?: unknown } } }).evidence?.raw?.ruleId;

  // Best-effort feedback insert — never let a missing table block the dismiss.
  await admin
    .from("finding_feedback")
    .insert({
      org_id: (f as { org_id: string }).org_id,
      finding_id: id,
      kind: "false_positive",
      vuln_class: (f as { vuln_class?: string }).vuln_class ?? null,
      rule_id: typeof ruleId === "string" ? ruleId : null,
      title: (f as { title?: string }).title ?? null,
      location: (f as { location?: string }).location ?? null,
      fingerprint: (f as { fingerprint?: string }).fingerprint ?? null,
      note,
      created_by: auth.user?.id ?? null,
    })
    .then(
      () => {},
      (e: unknown) => console.warn("finding_feedback insert skipped:", e instanceof Error ? e.message : e),
    );

  await admin.from("findings").update({ status: "dismissed" }).eq("id", id);
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
