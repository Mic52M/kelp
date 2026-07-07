"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { ensureTenant } from "@/lib/tenant";
import { CONSENT_V2_TEXT, CONSENT_VERSION_LATEST } from "@kelp/core";
import {
  listSupabaseProjects,
  validateSupabaseReadonlyConnString,
  putCredential,
  enqueueScanForProject,
  drainScans,
  saveActiveTestConsent,
  revokeActiveTestConsent,
  setAppBaseUrl,
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
  await enqueueScanForProject({ orgId, projectId, classes: ["rls"], trigger: "manual" });
  after(() => drainScans().catch(() => {}));

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  return {
    ok: true,
    message: `Connected as "${role}" — a fresh RLS scan is running with the least-privilege role.`,
  };
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
  const aEmail = String(formData.get("accountAEmail") ?? "").trim();
  const aPassword = String(formData.get("accountAPassword") ?? "");
  const bEmail = String(formData.get("accountBEmail") ?? "").trim();
  const bPassword = String(formData.get("accountBPassword") ?? "");

  if (!projectId) return { ok: false, message: "Pick a project." };
  if (appBaseUrl && !/^https?:\/\//i.test(appBaseUrl)) {
    return { ok: false, message: "App URL must start with http:// or https://." };
  }
  const partialA = Boolean(aEmail) !== Boolean(aPassword);
  const partialB = Boolean(bEmail) !== Boolean(bPassword);
  if (partialA || partialB) {
    return { ok: false, message: "Each test account needs both email and password." };
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

  const { orgId } = await ensureTenant({ id: user.id, email: user.email });
  await setAppBaseUrl(projectId, appBaseUrl || null);
  if (aEmail && aPassword) {
    await putCredential(
      orgId,
      projectId,
      "app_test_account_a",
      JSON.stringify({ email: aEmail, password: aPassword }),
    );
  }
  if (bEmail && bPassword) {
    await putCredential(
      orgId,
      projectId,
      "app_test_account_b",
      JSON.stringify({ email: bEmail, password: bPassword }),
    );
  }

  revalidatePath("/dashboard/settings");
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
  return { ok: true, message: "Active-testing consent revoked." };
}
