// POST /api/free-scan/[id]/email — capture email at the reveal moment (#32).
//
// V1: server records the email against the free scan, which flips the GET
// endpoint to reveal all findings. No magic link, no auto-migration to a paid
// dashboard — those are follow-ups (see issue #32 v2 notes). The user can sign
// up normally from the reveal CTA; a future job will merge their free scan
// into the new org's projects/scans/findings on first login (keyed on email).
//
// Idempotent: first email wins, subsequent writes are no-ops (see
// captureFreeScanEmail's coalesce clause).

import { NextResponse } from "next/server";
import { captureFreeScanEmail, getFreeScanById } from "@kelp/worker";
import { track, hashEmail } from "@/lib/analytics";

interface Body {
  email?: unknown;
}

// RFC-5322 is baroque; the pragmatic test that ships everywhere.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const row = await getFreeScanById(id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Silently accept even before the scan completes — the client will keep
  // polling and see revealed findings as soon as they land.
  await captureFreeScanEmail(id, email);

  // Product analytics (#34): keyed on the scan slug so the whole free-scan
  // funnel sits under one Person timeline. Email is hashed — same identity
  // policy as elsewhere; the raw address stays in `free_scans.email`.
  track(row.slug, "free_scan.email_captured", { email_sha256: hashEmail(email) });

  return NextResponse.json({ ok: true });
}
