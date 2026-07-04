// GitHub App webhook: on `push` to a connected repo's default branch, enqueue
// a secret re-scan (issue #4). Server-to-server: the middleware auth matcher
// does NOT cover /api/*, so we authenticate the caller via the HMAC signature
// header only. `ping` events (sent when the webhook is added) get a 200.
//
// Non-matching pushes (non-default branch, unknown repo/installation) return
// 200 with an "ignored" body — otherwise GitHub retries indefinitely.

import { after, NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { drainScans, enqueueScanForProject, findProjectByRepo } from "@kelp/worker";

function verify(payload: Buffer, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    // Fail closed — if the secret isn't set, we can't authenticate at all.
    return NextResponse.json({ error: "webhook not configured" }, { status: 503 });
  }

  const raw = Buffer.from(await req.arrayBuffer());
  if (!verify(raw, req.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const event = req.headers.get("x-github-event");
  if (event === "ping") return NextResponse.json({ ok: true });
  if (event !== "push") return NextResponse.json({ ignored: `event ${event}` });

  interface PushPayload {
    ref?: string;
    repository?: { full_name?: string; default_branch?: string };
    installation?: { id?: number };
  }
  const payload = JSON.parse(raw.toString("utf8")) as PushPayload;
  const repoFullName = payload.repository?.full_name;
  const defaultBranch = payload.repository?.default_branch;
  const installationId = payload.installation?.id;
  const ref = payload.ref;

  if (!repoFullName || !defaultBranch || !installationId || !ref) {
    return NextResponse.json({ ignored: "incomplete payload" });
  }
  // Kelp's secret scanner reads the default branch tarball, so only pushes to
  // that branch change what a re-scan would see.
  if (ref !== `refs/heads/${defaultBranch}`) {
    return NextResponse.json({ ignored: "non-default branch" });
  }

  const project = await findProjectByRepo(repoFullName, installationId);
  if (!project) return NextResponse.json({ ignored: "no matching project" });

  const { scanId } = await enqueueScanForProject({
    orgId: project.orgId,
    projectId: project.id,
    classes: ["secret"],
    trigger: "webhook_push",
  });

  // Kick the local drain so scans run without a separate worker in dev; in prod
  // the poll loop / queue worker picks it up anyway.
  after(() => drainScans().catch((e) => console.error("webhook drain failed:", e)));

  return NextResponse.json({ enqueued: true, scanId });
}
