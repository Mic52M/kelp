// GET /api/scan/status/[id] — status snapshot for the kelp/check GitHub
// Action's polling loop (#36).
//
// Auth is the same shape as /api/scan/from-action: the caller MUST present
// the workflow's ephemeral GITHUB_TOKEN as a bearer, and the repo it can
// read has to match the scan's project. This prevents someone with a scanId
// from another org's scan from reading its counts (they wouldn't have a
// GITHUB_TOKEN valid for that repo).
//
// Contract:
//   Headers: Authorization: Bearer <github_token>
//            X-Kelp-Repo: owner/name  (the repo the workflow runs in)
//   200:     { scanId, status: "queued"|"running"|"succeeded"|"failed",
//              headSha, baseSha, counts: {critical, high, medium, low},
//              reportSlug: string|null, finishedAt: string|null }
//   401:     { error: "invalid_github_token" }
//   403:     { error: "repo_mismatch" }
//   404:     { error: "scan_not_found" }
//
// The client polls with a bounded budget (Action side: ~90s wall clock),
// then either succeeds, fails on new high/crit findings, or times out and
// posts a "still running" comment.

import { NextResponse, type NextRequest } from "next/server";
import { findAnyProjectByRepo, loadScanStatus, scanBelongsToProject } from "@kelp/worker";

function bearer(req: NextRequest): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

async function verifyGithubToken(token: string, repoFullName: string): Promise<string | null> {
  const [owner, name] = repoFullName.split("/");
  if (!owner || !name) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { full_name?: string };
    return typeof body.full_name === "string" ? body.full_name : null;
  } catch {
    return null;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const token = bearer(req);
  const repo = req.headers.get("x-kelp-repo") ?? "";
  if (!token) return NextResponse.json({ error: "missing_bearer_token" }, { status: 401 });
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    return NextResponse.json({ error: "missing_repo_header" }, { status: 400 });
  }

  const verified = await verifyGithubToken(token, repo);
  if (!verified) {
    return NextResponse.json({ error: "invalid_github_token" }, { status: 401 });
  }
  if (verified.toLowerCase() !== repo.toLowerCase()) {
    return NextResponse.json({ error: "repo_mismatch" }, { status: 403 });
  }

  const project = await findAnyProjectByRepo(repo);
  if (!project) {
    return NextResponse.json({ error: "repo_not_connected" }, { status: 404 });
  }

  const { id } = await params;
  const status = await loadScanStatus(id);
  if (!status) {
    return NextResponse.json({ error: "scan_not_found" }, { status: 404 });
  }

  // Defense in depth: the scanId belongs to the project the repo maps to.
  // Otherwise someone with a stale token could probe scan ids across orgs.
  // (loadScanStatus doesn't return projectId; re-check by asserting the
  // scanId is one this project owns.)
  const belongs = await scanBelongsToProject(id, project.id);
  if (!belongs) {
    return NextResponse.json({ error: "scan_not_found" }, { status: 404 });
  }

  return NextResponse.json(status);
}
