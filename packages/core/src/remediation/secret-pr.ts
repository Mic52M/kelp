// Generates the pull-request metadata for remediating an exposed secret.
// Deterministic: given a secret finding, produce a branch name, title, commit
// message and body. The PR moves the value to an environment variable; the
// actual file edit is applied by the GitHub connector using the finding's
// location. We NEVER put the secret value in the PR — only its masked preview.
//
// Issue #47: branch is now `kelp/fix-<fingerprint>` and the commit + PR body
// both carry a `Kelp-Finding: <fingerprint>` trailer so the push-webhook
// fingerprint-closure path can match a merged PR back to its finding.

import type { SecretFinding } from "../scanners/secrets.js";

export interface SecretPr {
  branch: string;
  title: string;
  commitMessage: string;
  body: string;
  /** suggested env var name for the moved secret */
  envVar: string;
}

const ENV_NAMES: Record<string, string> = {
  "stripe-secret-live": "STRIPE_SECRET_KEY",
  "stripe-secret-test": "STRIPE_SECRET_KEY",
  "aws-access-key-id": "AWS_ACCESS_KEY_ID",
  "github-token": "GITHUB_TOKEN",
  "github-pat-fine": "GITHUB_TOKEN",
  "openai-key": "OPENAI_API_KEY",
  "google-api-key": "GOOGLE_API_KEY",
  "slack-token": "SLACK_TOKEN",
  "supabase-service-role": "SUPABASE_SERVICE_ROLE_KEY",
};

/** Suggested environment-variable name for a detected secret's rule. */
export function suggestedEnvVar(ruleId: string): string {
  return ENV_NAMES[ruleId] ?? "SECRET_VALUE";
}

export function generateSecretPr(finding: SecretFinding): SecretPr {
  const envVar = ENV_NAMES[finding.ruleId] ?? "SECRET_VALUE";
  // Per #47: branch is kelp/fix-<fingerprint> so the fingerprint-closure
  // path on PR merge can identify the finding without parsing the title.
  const branch = `kelp/fix-${finding.fingerprint}`;
  const title = `Move exposed ${finding.provider} secret out of source code`;

  const rotation =
    finding.severity === "critical"
      ? `\n\n**Rotate this key now.** It was committed to your repository and must ` +
        `be considered compromised. Generate a new one in your ${finding.provider} ` +
        `dashboard and revoke the old value.`
      : "";

  // Kelp-Finding trailer appears in BOTH the PR body and the commit message
  // (defense in depth: the PR body is the primary signal, the commit trailer
  // is the fallback if a reformat or squash strips the body).
  const kelpFindingTrailer = `Kelp-Finding: ${finding.fingerprint}`;

  // PR body has the six sections the spec calls for:
  //   What / Why / How Kelp verified / Rollback / Before merging / trailer.
  const body =
    `## What` + `\n\n` +
    `Kelp found a **${finding.severity}** severity \`secret\` finding at ` +
    `\`${finding.path}:${finding.line}\`.` + `\n\n` +
    `**Finding:** ${finding.title}` + `\n` +
    `**Severity:** ${finding.severity}` + `\n` +
    `**Class:** secret` + `\n` +
    `**Detected value (masked):** \`${finding.preview}\`` + `\n\n` +
    `## Why` + `\n\n` +
    `The value is committed to your repository's history. Anyone with read ` +
    `access to the repo can use it to impersonate your ${finding.provider} ` +
    `integration. ` +
    (finding.clientSide
      ? `It ships in your **frontend bundle**, so every visitor can read it. `
      : `It is referenced from your server-side code, so anyone with read ` +
        `access to the repo (current or former) can use it. `) +
    `${rotation}` + `\n\n` +
    `This change moves the value to the \`${envVar}\` environment variable, so it ` +
    `no longer lives in the source tree. The code now reads ` +
    `\`process.env.${envVar}\` (or the equivalent in your framework).` + `\n\n` +
    `## How Kelp verified this` + `\n\n` +
    `Kelp scanned the repository, located the hard-coded value with the ` +
    `\`${finding.ruleId}\` pattern at \`${finding.path}:${finding.line}\`, and read ` +
    `the surrounding file to confirm the context. See the evidence panel on the ` +
    `finding for the file excerpt.` + `\n\n` +
    `## Rollback` + `\n\n` +
    `Revert this commit, or close this PR without merging. Reverting restores ` +
    `the hard-coded value (which is the original, vulnerable state); the next ` +
    `Kelp scan will re-open the finding.` + `\n\n` +
    `## Before merging` + `\n\n` +
    `1. Set \`${envVar}\` in your deployment (Vercel / Netlify / Fly / Railway / etc.).` + `\n` +
    `2. Confirm the app still builds locally with the variable set.` + `\n` +
    `3. (Recommended) Rotate the ${finding.provider} credential; the old value is ` +
    `in the git history regardless of this fix.` + `\n\n` +
    `— Opened by Kelp. Review before merging.` + `\n\n` +
    `${kelpFindingTrailer}`;

  return {
    branch,
    title,
    // Trailer on the commit too, so a push to the kelp/* branch (or a squash
    // merge) still carries the fingerprint for the closure path.
    commitMessage: `Move ${finding.provider} secret to ${envVar}` + `\n\n` + kelpFindingTrailer,
    body,
    envVar,
  };
}

/**
 * Result of {@link isPatchable}. The UI uses `reason` to render a tooltip
 * when the "Open fix PR" button is disabled (issue #47).
 */
export type Patchability =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Single source of truth for whether Kelp can open an automatic fix PR for
 * a finding. Today only high-confidence exposed-secret findings are
 * patchable; other vuln classes need either a DB-side change (RLS, GRANTs)
 * or a human-authored fix that we don't want to automate.
 *
 * The decision lives here, not in the worker, so the UI can call it too and
 * gate the button with the same reasoning the backend enforces.
 */
export function isPatchable(finding: {
  vuln_class: string;
  confidence?: "high" | "medium";
}): Patchability {
  if (finding.vuln_class !== "secret") {
    return {
      ok: false,
      reason:
        "Only exposed-secret findings have an automatic code-side fix. " +
        "Use the copy prompt for other classes.",
    };
  }
  if (finding.confidence !== "high") {
    return {
      ok: false,
      reason:
        "Kelp isn't confident enough to auto-fix this one. " +
        "Use the copy prompt and review manually.",
    };
  }
  return { ok: true };
}