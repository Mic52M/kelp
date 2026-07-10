"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { ensureTenant } from "@/lib/tenant";
import { CONSENT_V3_TEXT, CONSENT_VERSION_LATEST } from "@kelp/core";
import {
  listSupabaseProjects,
  validateSupabaseReadonlyConnString,
  putCredential,
  saveActiveTestConsent,
  revokeActiveTestConsent,
  setAppBaseUrl,
  setSupabaseProjectRef,
  getProjectConfigStatus,
  getCredential,
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

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/configuration");
  return {
    ok: true,
    message: "Management token saved. Open Overview to run a scan when you're ready.",
  };
}

/**
 * Store a per-project read-only Postgres connection string (issue #5) as the
 * preferred credential for Supabase scanning. Falls back to the Management
 * PAT if this isn't set. Validated with a live probe before storing.
 */
export async function reconnectSupabaseReadonlyAction(
  _prev: ReconnectState,
  formData: FormData,
): Promise<ReconnectState> {
  const projectId = String(formData.get("projectId") ?? "");
  const connString = String(formData.get("connectionString") ?? "").trim();
  if (!projectId || !connString) return { ok: false, message: "Pick a project and paste a connection string." };
  if (!/^postgres(ql)?:\/\//i.test(connString)) {
    return { ok: false, message: "That doesn't look like a postgres:// URL." };
  }

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, message: "You're signed out." };

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, message: "That project no longer exists." };

  let role: string;
  try {
    ({ role } = await validateSupabaseReadonlyConnString(connString));
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Connection failed." };
  }

  const { orgId } = await ensureTenant({ id: user.id, email: user.email });
  await putCredential(orgId, projectId, "supabase_readonly_connstring", connString);

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/configuration");
  revalidatePath("/dashboard");
  return {
    ok: true,
    message: `Saved — connected as "${role}". Open Overview to run a scan when you're ready.`,
  };
}

export type ConsentActionState = { ok: boolean; message: string } | null;

/**
 * Grant v2 active-testing consent for a project (issue #24). The multi-specialist
 * campaign refuses to run without a non-revoked v2 row for the project. The
 * verbatim CONSENT_V3_TEXT is stored on the row for audit — if we change the
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
    consentText: CONSENT_V3_TEXT,
    consentVersion: CONSENT_VERSION_LATEST,
    consentedBy: user.id,
  });

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/configuration");
  return { ok: true, message: "Active-testing consent granted." };
}

export type ActivePentestConfigState = { ok: boolean; message: string } | null;

/**
 * Configure the two things a project needs before an active-pentest campaign
 * can run (#27): the deployed app's base URL, and two test-account credentials
 * (email + password) stored encrypted. Called from Settings. Empty
 * `appBaseUrl` clears it (useful for temporarily disabling active-pentest on a
 * project without revoking consent).
 */
export async function configureActivePentestAction(
  _prev: ActivePentestConfigState,
  formData: FormData,
): Promise<ActivePentestConfigState> {
  const projectId = String(formData.get("projectId") ?? "");
  const appBaseUrl = String(formData.get("appBaseUrl") ?? "").trim();
  const anonKey = String(formData.get("supabaseAnonKey") ?? "").trim();
  const supabaseRef = String(formData.get("supabaseProjectRef") ?? "").trim();
  const aEmail = String(formData.get("accountAEmail") ?? "").trim();
  const aPassword = String(formData.get("accountAPassword") ?? "");
  const bEmail = String(formData.get("accountBEmail") ?? "").trim();
  const bPassword = String(formData.get("accountBPassword") ?? "");

  if (!projectId) return { ok: false, message: "Pick a project." };
  if (appBaseUrl && !/^https?:\/\//i.test(appBaseUrl)) {
    return { ok: false, message: "App URL must start with http:// or https://." };
  }
  if (anonKey && !/^ey[A-Za-z0-9._-]{20,}$/.test(anonKey) && !/^sb[a-z0-9_]+_/.test(anonKey)) {
    // Supabase anon keys are always long strings — either legacy JWTs (start
    // with "eyJ...") or the new sb_publishable_… format. Refuse obvious typos
    // early so we don't burn a scan on a bad key.
    return { ok: false, message: "That doesn't look like a Supabase anon key (JWT or sb_publishable_…)." };
  }
  if (supabaseRef && !/^[a-z0-9]{16,}$/.test(supabaseRef)) {
    // Supabase project refs are 20-char lowercase alphanumeric strings
    // (they're the subdomain of <ref>.supabase.co). Reject obvious typos.
    return { ok: false, message: "Supabase project ref must be lowercase alphanumeric (20 chars, e.g. abcdefghijklmnopqrst)." };
  }

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, message: "You're signed out." };

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, message: "That project no longer exists." };

  const status = await getProjectConfigStatus(projectId);
  // Allow email-only or password-only edits when the credential already exists
  // ("leave blank to keep" UX). First-time creation still requires both.
  const partialA = Boolean(aEmail) !== Boolean(aPassword);
  const partialB = Boolean(bEmail) !== Boolean(bPassword);
  const canPartialA = partialA && status.testAccountAEmail !== null;
  const canPartialB = partialB && status.testAccountBEmail !== null;
  if ((partialA && !canPartialA) || (partialB && !canPartialB)) {
    return {
      ok: false,
      message: "New test accounts need both email and password (updates can leave one blank).",
    };
  }

  const { orgId } = await ensureTenant({ id: user.id, email: user.email });
  await setAppBaseUrl(projectId, appBaseUrl || null);
  if (supabaseRef) {
    // Manual override — leave blank to keep the current value (empty string
    // means "no change", not "clear").
    await setSupabaseProjectRef(projectId, supabaseRef);
  }
  if (anonKey) {
    await putCredential(orgId, projectId, "supabase_anon_key", anonKey);
  }
  await mergeAndStoreTestAccount(orgId, projectId, "app_test_account_a", aEmail, aPassword);
  await mergeAndStoreTestAccount(orgId, projectId, "app_test_account_b", bEmail, bPassword);

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/configuration");
  revalidatePath("/dashboard");
  return { ok: true, message: "Active-pentest configuration saved." };
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
  revalidatePath("/dashboard/configuration");
  return { ok: true, message: "Active-testing consent revoked." };
}

/**
 * Store a test-account credential merging with what's already there so the
 * user can update just the email OR just the password ("leave blank to keep").
 * Skips write when both fields are blank (nothing to change).
 */
async function mergeAndStoreTestAccount(
  orgId: string,
  projectId: string,
  kind: "app_test_account_a" | "app_test_account_b",
  email: string,
  password: string,
): Promise<void> {
  if (!email && !password) return;
  let currentEmail = "";
  let currentPassword = "";
  const existing = await getCredential(projectId, kind);
  if (existing) {
    try {
      const parsed = JSON.parse(existing) as { email?: unknown; password?: unknown };
      if (typeof parsed.email === "string") currentEmail = parsed.email;
      if (typeof parsed.password === "string") currentPassword = parsed.password;
    } catch {
      // Fall through — corrupted row will be replaced by the new values below.
    }
  }
  const nextEmail = email || currentEmail;
  const nextPassword = password || currentPassword;
  if (!nextEmail || !nextPassword) return;
  await putCredential(orgId, projectId, kind, JSON.stringify({ email: nextEmail, password: nextPassword }));
}
