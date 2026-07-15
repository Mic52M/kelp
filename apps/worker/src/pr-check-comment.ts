// PR comment posting for the kelp/check GitHub Action (#36 Phase 2).
//
// After a `pr_check` scan finishes we post (or update) a single Kelp-branded
// comment on the PR with the diff-against-main verdict. The Action still
// enforces the merge gate on its own (via the `newFindings` fields of the
// status endpoint) — the comment is human-facing polish.
//
// A stable HTML marker (KELP_COMMENT_MARKER) lets subsequent runs on new
// commits update the SAME comment instead of stacking new ones every push.

import { createGitHubConnector } from "./connectors/github.js";

/** Marker embedded in every kelp/check comment. Do NOT change without a
 *  migration story — old comments on live PRs would orphan and each new run
 *  would add a fresh comment beside them. */
const KELP_COMMENT_MARKER = "<!-- kelp:pr_check -->";

type SeverityCounts = {
  critical: number;
  high: number;
  medium: number;
  low: number;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

function totalGating(newFindings: SeverityCounts): number {
  return newFindings.critical + newFindings.high;
}

function totalAll(counts: SeverityCounts): number {
  return counts.critical + counts.high + counts.medium + counts.low;
}

function severityLine(counts: SeverityCounts): string {
  const parts: string[] = [];
  if (counts.critical > 0) parts.push(`**${counts.critical}** critical`);
  if (counts.high > 0) parts.push(`**${counts.high}** high`);
  if (counts.medium > 0) parts.push(`**${counts.medium}** medium`);
  if (counts.low > 0) parts.push(`**${counts.low}** low`);
  return parts.join(" · ");
}

function dashboardUrl(projectId: string): string {
  const base = (process.env.KELP_APP_BASE_URL ?? "https://kelp.build").replace(/\/+$/, "");
  return `${base}/dashboard/${projectId}`;
}

/** Build the comment body. Verdict-first so the reviewer sees pass/fail at a
 *  glance; footer names the tool so people can find Kelp from the PR. */
export function renderPrCheckComment(input: {
  status: "succeeded" | "failed";
  headSha: string;
  newFindings: SeverityCounts;
  totalOpen: SeverityCounts;
  dashboardHref: string;
  errorMessage?: string | null;
}): string {
  const shortSha = input.headSha.slice(0, 7);

  if (input.status === "failed") {
    const err = (input.errorMessage ?? "").slice(0, 400);
    return [
      KELP_COMMENT_MARKER,
      "### ⚠️ kelp/check couldn't scan this PR",
      "",
      `Kelp errored while scanning \`${shortSha}\`. The check will retry on the next commit.`,
      err ? `\n<details><summary>Details</summary>\n\n\`\`\`\n${err}\n\`\`\`\n</details>` : "",
      "",
      `— [Kelp](${input.dashboardHref})`,
    ].join("\n");
  }

  const gating = totalGating(input.newFindings);
  if (gating > 0) {
    return [
      KELP_COMMENT_MARKER,
      `### ❌ kelp/check — new security issues on \`${shortSha}\``,
      "",
      `This PR introduces ${severityLine({
        critical: input.newFindings.critical,
        high: input.newFindings.high,
        medium: 0,
        low: 0,
      })} finding${gating === 1 ? "" : "s"} not present on the base branch.`,
      "",
      `**New in this PR:** ${severityLine(input.newFindings) || "none"}`,
      "",
      `[Open the finding details on Kelp →](${input.dashboardHref})`,
      "",
      `— [Kelp](${input.dashboardHref}) · ${totalAll(input.totalOpen)} total open on this project`,
    ].join("\n");
  }

  const anyNew = totalAll(input.newFindings) > 0;
  return [
    KELP_COMMENT_MARKER,
    `### ✅ kelp/check — no blocking issues on \`${shortSha}\``,
    "",
    anyNew
      ? `New in this PR: ${severityLine(input.newFindings)} (medium/low only — merge is not blocked).`
      : "This PR doesn't introduce new security findings.",
    "",
    `— [Kelp](${input.dashboardHref}) · ${totalAll(input.totalOpen)} total open on this project`,
  ].join("\n");
}

/** Post (or update) the kelp/check comment on the PR. Never throws — a
 *  comment failure must not fail the scan itself; the caller logs. */
export async function postPrCheckComment(input: {
  installationId: number;
  repoFullName: string;
  prNumber: number;
  projectId: string;
  status: "succeeded" | "failed";
  headSha: string;
  newFindings: SeverityCounts;
  totalOpen: SeverityCounts;
  errorMessage?: string | null;
}): Promise<{ url: string; created: boolean } | null> {
  try {
    const gh = createGitHubConnector({
      appId: requireEnv("GITHUB_APP_ID"),
      privateKey: Buffer.from(
        requireEnv("GITHUB_APP_PRIVATE_KEY_BASE64"),
        "base64",
      ).toString("utf8"),
      installationId: input.installationId,
    });
    const body = renderPrCheckComment({
      status: input.status,
      headSha: input.headSha,
      newFindings: input.newFindings,
      totalOpen: input.totalOpen,
      dashboardHref: dashboardUrl(input.projectId),
      errorMessage: input.errorMessage ?? null,
    });
    return await gh.upsertPrComment(
      input.repoFullName,
      input.prNumber,
      KELP_COMMENT_MARKER,
      body,
    );
  } catch (e) {
    console.warn(
      "pr_check comment post failed:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}
