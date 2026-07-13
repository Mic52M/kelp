// GET /api/free-scan/[id] — poll the status of a free scan.
//
// Public endpoint. Returns:
//   - status, timings, error
//   - preview findings: first N un-redacted (visible without email)
//   - locked findings: the rest, redacted (title + class + severity only)
//   - counts by severity
//
// If `captured_email` is set on the row we assume the user completed the
// magic-link flow and can see all findings un-redacted. Server-filtered — the
// client never receives locked fix prompts / file:line locations.

import { NextResponse } from "next/server";
import { getFreeScanById, type FreeScanPublicView } from "@kelp/worker";
import type { DetectedFinding, Severity } from "@kelp/core";

const PREVIEW_UNLOCKED = 2;

interface Preview {
  vulnClass: string;
  severity: Severity;
  fingerprint: string;
  title: string;
  location: string | null;
  explanation: string;
}
interface Locked {
  vulnClass: string;
  severity: Severity;
  fingerprint: string;
  title: string;
}

const SEV_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function coerceFindings(raw: unknown[]): DetectedFinding[] {
  return raw.filter((x): x is DetectedFinding =>
    !!x && typeof x === "object" && "vulnClass" in x && "severity" in x,
  );
}

function shape(row: FreeScanPublicView) {
  const findings = coerceFindings(row.findings);
  findings.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  const emailCaptured = !!row.capturedEmail;

  // Un-redacted set: two teaser findings before email capture; all findings
  // once captured. That's the "reveal" mechanic — nothing else changes shape,
  // so the client can keep rendering the same list.
  const revealed = emailCaptured ? findings : findings.slice(0, PREVIEW_UNLOCKED);
  const preview: Preview[] = revealed.map((f) => ({
    vulnClass: f.vulnClass,
    severity: f.severity,
    fingerprint: f.fingerprint,
    title: f.title,
    location: f.location,
    explanation: f.explanation,
  }));
  const locked: Locked[] = findings.slice(PREVIEW_UNLOCKED).map((f) => ({
    vulnClass: f.vulnClass,
    severity: f.severity,
    fingerprint: f.fingerprint,
    title: f.title,
  }));

  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity]++;

  return {
    id: row.id,
    slug: row.slug,
    repoUrl: row.repoUrl,
    status: row.status,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    durationMs: row.durationMs,
    error: row.error,
    emailCaptured,
    totalFindings: findings.length,
    counts,
    preview,
    locked: emailCaptured ? [] : locked,
    // When email is captured, hand over ALL findings un-redacted for the
    // pre-signup reveal — the signup itself happens on the magic-link callback.
    findings: emailCaptured ? findings : null,
    // Diagnostic envelope — what Kelp actually did. Always safe to show.
    diagnostic: row.diagnostic,
  };
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  // Simple id-format guard so a hostile client can't drive random SQL.
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const row = await getFreeScanById(id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(shape(row), {
    headers: { "cache-control": "no-store" },
  });
}
