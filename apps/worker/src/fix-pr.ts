// Opens a real GitHub PR that fixes an exposed-secret finding: replaces the
// hard-coded value with a process.env reference (edit built in @kelp/core),
// commits to a kelp/* branch and opens the PR against the default branch.
// The secret value never enters the PR title/body/commit — generateSecretPr
// only ever uses the masked preview, and applySecretFix guarantees the value
// is fully removed from the committed file.

import {
  applySecretFix,
  generateSecretPr,
  type SecretFinding,
} from "@kelp/core";
import { getPool, loadProject, writeAudit } from "./db.js";
import { createGitHubConnector, FixNotApplicableError } from "./connectors/github.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

export type SecretFixPrResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

const FALLBACK_TO_PROMPT =
  "Kelp couldn't build a safe automatic fix for this file — the secret may have " +
  "moved, already been fixed, or sit inside a larger string. Use the fix prompt instead.";

const NEEDS_REVIEW =
  "This detection isn't confident enough for an automatic PR. Review it and use " +
  "the fix prompt below.";

/**
 * Open (or reuse) the fix PR for a secret finding. Caller must have verified
 * the requesting user owns the finding — this runs with the privileged pool.
 */
export async function openSecretFixPr(
  findingId: string,
  actorUserId?: string,
): Promise<SecretFixPrResult> {
  const { rows } = await getPool().query(
    `select id, org_id, project_id, vuln_class, evidence from findings where id = $1`,
    [findingId],
  );
  if (rows.length === 0) return { ok: false, error: "Finding not found." };
  const finding = rows[0] as {
    id: string;
    org_id: string;
    project_id: string;
    vuln_class: string;
    evidence: { raw?: SecretFinding } | null;
  };
  if (finding.vuln_class !== "secret") {
    return { ok: false, error: "Fix PRs are only available for exposed secrets." };
  }
  const raw = finding.evidence?.raw;
  if (!raw?.path || !raw.fingerprint) {
    return { ok: false, error: "This finding predates fix PRs — re-scan the project first." };
  }
  // Only auto-open PRs for high-confidence detections (branded provider keys,
  // service_role). Medium-confidence ones (generic JWTs, high-entropy strings)
  // are too ambiguous to rewrite unattended — a wrong PR costs more trust than a
  // prompt the user reviews. This is the backend guard behind the UI's gate.
  if (raw.confidence !== "high") {
    return { ok: false, error: NEEDS_REVIEW };
  }

  // Idempotent: if we already opened a PR for this finding, return it.
  const prev = await getPool().query(
    `select github_pr_url from remediations
     where finding_id = $1 and github_pr_url is not null
     order by created_at desc limit 1`,
    [findingId],
  );
  if (prev.rows.length > 0) {
    return { ok: true, url: prev.rows[0].github_pr_url as string };
  }

  const project = await loadProject(finding.project_id);
  if (!project?.repoFullName || project.installationId == null) {
    return { ok: false, error: "This project has no connected GitHub repository." };
  }

  const gh = createGitHubConnector({
    appId: requireEnv("GITHUB_APP_ID"),
    privateKey: Buffer.from(requireEnv("GITHUB_APP_PRIVATE_KEY_BASE64"), "base64").toString("utf8"),
    installationId: project.installationId,
  });
  const meta = generateSecretPr(raw);

  let url: string;
  try {
    const res = await gh.openFixPr(project.repoFullName, {
      branch: meta.branch,
      title: meta.title,
      body: meta.body,
      commitMessage: meta.commitMessage,
      path: raw.path,
      edit: (content) => applySecretFix({ path: raw.path, content }, raw)?.content ?? null,
    });
    url = res.url;
  } catch (e) {
    if (e instanceof FixNotApplicableError) return { ok: false, error: FALLBACK_TO_PROMPT };
    const status = (e as { status?: number }).status;
    if (status === 404) {
      return { ok: false, error: "The file with the secret could not be found — re-scan the project." };
    }
    if (status === 403) {
      return { ok: false, error: "GitHub declined the write — check the Kelp app's repository permissions." };
    }
    console.error("openSecretFixPr failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: "GitHub rejected the request. Try again in a minute." };
  }

  await getPool().query(
    `insert into remediations (org_id, finding_id, kind, status, payload, github_pr_url)
     values ($1, $2, 'secret_pr', 'pr_opened', $3, $4)`,
    [
      finding.org_id,
      findingId,
      JSON.stringify({ branch: meta.branch, title: meta.title, envVar: meta.envVar, path: raw.path }),
      url,
    ],
  );
  await getPool().query(
    `update findings set status = 'pr_opened', updated_at = now() where id = $1`,
    [findingId],
  );
  await writeAudit({
    orgId: finding.org_id,
    projectId: finding.project_id,
    actorType: "user",
    actorId: actorUserId ?? "web",
    action: "secret_fix_pr_opened",
    resource: url,
    metadata: { findingId, path: raw.path, branch: meta.branch },
  });

  return { ok: true, url };
}
