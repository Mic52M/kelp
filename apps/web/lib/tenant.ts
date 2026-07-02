import { getAdminSupabase } from "./supabase/server";

/**
 * Ensure the signed-in user has a row in our schema and belongs to an org.
 * On first login we create the user, a personal org, and an owner membership.
 * Runs with the service-role client (bypasses RLS) — bootstrap is privileged.
 */
export async function ensureTenant(user: { id: string; email: string }): Promise<{ orgId: string }> {
  const admin = getAdminSupabase();

  await admin.from("users").upsert({ id: user.id, email: user.email }, { onConflict: "id" });

  const { data: existing } = await admin
    .from("memberships")
    .select("org_id")
    .eq("user_id", user.id)
    .limit(1);

  if (existing && existing.length > 0) {
    return { orgId: existing[0]!.org_id as string };
  }

  const workspaceName = `${user.email.split("@")[0]}'s workspace`;
  const { data: org, error } = await admin
    .from("orgs")
    .insert({ name: workspaceName })
    .select("id")
    .single();
  if (error || !org) throw new Error(`failed to create org: ${error?.message}`);

  await admin
    .from("memberships")
    .insert({ org_id: org.id, user_id: user.id, role: "owner" });

  return { orgId: org.id as string };
}
