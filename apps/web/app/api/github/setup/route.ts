// GitHub App post-installation callback (issue #14).
//
// After a user installs the Kelp GitHub App, GitHub redirects here with
// ?installation_id=…&setup_action=…&state=…. The `state` is a signed token we
// minted in startGithubInstallAction; it tells us which org started the install,
// so we can attribute the installation without server-side session storage.
//
// This route is intentionally NOT under the middleware auth matcher, so we do
// our own auth here: the visitor must be signed in AND a member of the org the
// state names, before we store anything.

import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { registerGithubInstallation, verifyInstallState } from "@kelp/worker";

function back(req: NextRequest, status: "connected" | "error" | "pending"): NextResponse {
  const url = new URL("/onboarding", req.nextUrl.origin);
  url.searchParams.set("github", status);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;
  const state = params.get("state");
  const installationIdRaw = params.get("installation_id");
  const setupAction = params.get("setup_action");

  // "request": the user asked an org admin to approve the install — no
  // installation exists yet. Send them back with a soft, non-error message.
  if (setupAction === "request" || !installationIdRaw) {
    return back(req, "pending");
  }

  const orgId = state ? verifyInstallState(state) : null;
  if (!orgId) return back(req, "error");

  const installationId = Number(installationIdRaw);
  if (!Number.isInteger(installationId)) return back(req, "error");

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Not signed in on this browser — bounce to login, then back here.
    const login = new URL("/login", req.nextUrl.origin);
    login.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(login);
  }

  // Defense in depth: the signed state names the org, but confirm this user is
  // actually a member of it (RLS lets a user read only their own memberships).
  const { data: membership } = await supabase
    .from("memberships")
    .select("org_id")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return back(req, "error");

  try {
    await registerGithubInstallation({ orgId, installationId, connectedBy: user.id });
  } catch (e) {
    console.error("registerGithubInstallation failed:", e instanceof Error ? e.message : e);
    return back(req, "error");
  }

  return back(req, "connected");
}
