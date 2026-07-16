import { getAdminSupabase } from "./supabase/server";

/**
 * Ensure the signed-in user has a row in our schema and belongs to an org.
 * On first login we create the user, a personal org, and an owner membership.
 * Runs with the service-role client (bypasses RLS) — bootstrap is privileged.
 *
 * Robust against the "same email, new auth.users id" case that happens when
 * Supabase re-issues an auth row for the same email (e.g. after the auth
 * record was deleted or a fresh project link): we detect the legacy
 * public.users row by email, transfer any existing memberships onto the
 * new id, then drop the stale users row. Prior versions swallowed the
 * resulting unique-violation on email + FK error on memberships, which
 * produced orphan orgs (org rows with no membership row) on every login.
 */
export async function ensureTenant(user: { id: string; email: string }): Promise<{ orgId: string }> {
  const admin = getAdminSupabase();

  // Reconcile any legacy row with the same email under a different id.
  // citext + unique on email means we can't just upsert on id and hope.
  const { data: byEmail, error: byEmailErr } = await admin
    .from("users")
    .select("id")
    .eq("email", user.email)
    .limit(1);
  if (byEmailErr) throw new Error(`failed to look up users by email: ${byEmailErr.message}`);

  const legacyId = byEmail?.[0]?.id as string | undefined;
  if (legacyId && legacyId !== user.id) {
    // Move memberships onto the new id BEFORE we can safely drop the row.
    const { error: mvErr } = await admin
      .from("memberships")
      .update({ user_id: user.id })
      .eq("user_id", legacyId);
    if (mvErr) throw new Error(`failed to migrate memberships: ${mvErr.message}`);
    const { error: delErr } = await admin.from("users").delete().eq("id", legacyId);
    if (delErr) throw new Error(`failed to drop legacy users row: ${delErr.message}`);
  }

  const { error: upErr } = await admin
    .from("users")
    .upsert({ id: user.id, email: user.email }, { onConflict: "id" });
  if (upErr) throw new Error(`failed to upsert users row: ${upErr.message}`);

  const { data: existing, error: memErr } = await admin
    .from("memberships")
    .select("org_id")
    .eq("user_id", user.id)
    .limit(1);
  if (memErr) throw new Error(`failed to look up memberships: ${memErr.message}`);

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

  const { error: memInsErr } = await admin
    .from("memberships")
    .insert({ org_id: org.id, user_id: user.id, role: "owner" });
  if (memInsErr) {
    // Roll back the org row we just created — otherwise this is exactly the
    // orphan-org bug that motivated the whole hardening.
    await admin.from("orgs").delete().eq("id", org.id);
    throw new Error(`failed to create owner membership: ${memInsErr.message}`);
  }

  return { orgId: org.id as string };
}
