// POST /api/scan/from-action — enqueue a scan from the kelp/check GitHub
// Action (#36).
//
// Auth: Bearer <GITHUB_TOKEN>, where GITHUB_TOKEN is the workflow's
// ephemeral token (secrets.GITHUB_TOKEN in the workflow YAML). We verify it
// by round-tripping GET /repos/{owner}/{repo}: a token that can read the
// repo is proven to be running in that repo's workflow context. This
// authenticates the caller as "the workflow running on repo X" without any
// Kelp-specific credential the user has to configure.
//
// The repo MUST already be connected to a Kelp project (via the onboarding
// flow, so a github_installations row exists for its org). We refuse
// unrecognized repos with 404 so the Action can surface a friendly
// "connect this repo at kelp.dev/dashboard first" message.
//
// Contract:
//   Headers: Authorization: Bearer <github_token>
//   Body:    { repo: "owner/name", headSha: string, baseSha: string,
//              prNumber: number }
//   200:     { scanId, statusUrl }
//   400:     { error: "invalid_body" }
//   401:     { error: "invalid_github_token" }        (round-trip fails)
//   403:     { error: "repo_mismatch" }              (token can't read `repo`)
//   404:     { error: "repo_not_connected" }         (no Kelp project for it)
//   429:     { error: "rate_limited" }               (plan-gated)
//   500:     { error: "internal" }

import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import {
  drainScans,
  enqueueScanForProject,
  findAnyProjectByRepo,
} from "@kelp/worker";
import { PlanLimitError } from "@kelp/core";

interface Body {
  repo?: unknown;
  headSha?: unknown;
  baseSha?: unknown;
  prNumber?: unknown;
}

function bearer(req: NextRequest): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/** Round-trip verify: does this token identify a caller who can read `repo`?
 *  Returns the repo's canonical full_name on success, null on any failure. */
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

function isSha(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{7,40}$/i.test(v);
}

function isRepoFullName(v: unknown): v is string {
  return typeof v === "string" && /^[^/\s]+\/[^/\s]+$/.test(v) && v.length < 200;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = bearer(req);
  if (!token) {
    return NextResponse.json({ error: "missing_bearer_token" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const repo = body.repo;
  const headSha = body.headSha;
  const baseSha = body.baseSha;
  const prNumber = body.prNumber;

  if (
    !isRepoFullName(repo) ||
    !isSha(headSha) ||
    !isSha(baseSha) ||
    typeof prNumber !== "number" ||
    !Number.isInteger(prNumber) ||
    prNumber <= 0
  ) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const verifiedRepo = await verifyGithubToken(token, repo);
  if (!verifiedRepo) {
    return NextResponse.json({ error: "invalid_github_token" }, { status: 401 });
  }
  if (verifiedRepo.toLowerCase() !== repo.toLowerCase()) {
    // The token authenticates the caller for a different repo than the body
    // claims — someone is trying to enqueue a scan for a repo they don't
    // control. Refuse loudly.
    return NextResponse.json({ error: "repo_mismatch" }, { status: 403 });
  }

  // Find any Kelp project this repo is connected as. From the Action's side
  // we don't know the installation id — we accept the first project that
  // owns this repo across any of the org's installations.
  const project = await findAnyProjectByRepo(repo);
  if (!project) {
    return NextResponse.json({ error: "repo_not_connected" }, { status: 404 });
  }

  let scanId: string;
  try {
    ({ scanId } = await enqueueScanForProject({
      orgId: project.orgId,
      projectId: project.id,
      classes: ["secret"], // MVP: same class the push-webhook rescan uses
      trigger: "pr_check",
      headSha,
      baseSha,
    }));
  } catch (e) {
    if (e instanceof PlanLimitError) {
      return NextResponse.json(
        { error: "rate_limited", reason: e.code },
        { status: 429 },
      );
    }
    console.error("from-action enqueue failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  // Kick the local drain so scans run without a separate worker in dev; in
  // prod the queue worker owns delivery.
  after(() => drainScans().catch((e) => console.error("from-action drain failed:", e)));

  return NextResponse.json({
    scanId,
    statusUrl: `/api/scan/status/${scanId}`,
  });
}

