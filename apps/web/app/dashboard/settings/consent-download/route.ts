// Downloadable signed-consent record.
//
// GET /dashboard/settings/consent-download?projectId=<uuid>
//   → returns text/plain attachment containing:
//        · a small header with the signer, org, project, version, timestamp
//        · the verbatim consent text stored on the DB row
//   → 404 when the project has no active consent (or isn't visible to the
//     signed-in user under RLS).
//
// The download is intentionally plain text (not PDF) so it's trivial to
// diff, hash, and archive. If a user needs a formal PDF later, the same
// bytes serve as input to any renderer.

import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadActiveTestConsent, findUserEmail, findOrgName } from "@kelp/worker";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId") ?? "";
  if (!projectId) {
    return new NextResponse("Missing projectId", { status: 400 });
  }

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Not signed in", { status: 401 });

  // Ownership check via RLS: the user can only see projects they belong to.
  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return new NextResponse("Project not found", { status: 404 });

  const row = await loadActiveTestConsent(projectId);
  if (!row) return new NextResponse("No active consent on file", { status: 404 });

  const [signerEmail, orgName] = await Promise.all([
    findUserEmail(row.consentedBy),
    findOrgName(row.orgId),
  ]);

  const header =
    `KELP — SIGNED CONSENT RECORD\n` +
    `================================================================\n` +
    `Project      : ${project.name} (${row.projectId})\n` +
    `Organization : ${orgName ?? "—"} (${row.orgId})\n` +
    `Signer       : ${signerEmail ?? "unknown"} (${row.consentedBy})\n` +
    `Version      : ${row.consentVersion}\n` +
    `Signed at    : ${row.consentedAt.toISOString()} (UTC)\n` +
    `Consent id   : ${row.id}\n` +
    `================================================================\n\n`;

  const body = header + row.consentText + "\n";
  const safeName = project.name.replace(/[^a-z0-9._-]+/gi, "_");
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="kelp-consent-${safeName}-${row.consentVersion}.txt"`,
      "cache-control": "no-store",
    },
  });
}
