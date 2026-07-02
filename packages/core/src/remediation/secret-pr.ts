// Generates the pull-request metadata for remediating an exposed secret.
// Deterministic: given a secret finding, produce a branch name, title, commit
// message and body. The PR moves the value to an environment variable; the
// actual file edit is applied by the GitHub connector using the finding's
// location. We NEVER put the secret value in the PR — only its masked preview.

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

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

export function generateSecretPr(finding: SecretFinding): SecretPr {
  const envVar = ENV_NAMES[finding.ruleId] ?? "SECRET_VALUE";
  const branch = `kelp/remove-secret-${slug(finding.provider)}-${finding.fingerprint.slice(0, 8)}`;
  const title = `Move exposed ${finding.provider} secret out of source code`;

  const rotation =
    finding.severity === "critical"
      ? `\n\n**Rotate this key now.** It was committed to your repository and must ` +
        `be considered compromised. Generate a new one in your ${finding.provider} ` +
        `dashboard and revoke the old value.`
      : "";

  const body =
    `Kelp found a ${finding.title.toLowerCase()} at \`${finding.path}:${finding.line}\` ` +
    `(value \`${finding.preview}\`).\n\n` +
    `This change replaces the hard-coded value with the \`${envVar}\` environment ` +
    `variable so the secret no longer ships in your ${finding.clientSide ? "frontend bundle" : "source"}.\n\n` +
    `**Before merging:**\n` +
    `1. Set \`${envVar}\` in your deployment (Vercel/Netlify/Fly project settings).\n` +
    `2. Confirm the app still builds locally with the variable set.${rotation}\n\n` +
    `— Opened by Kelp. Review before merging.`;

  return {
    branch,
    title,
    commitMessage: `Move ${finding.provider} secret to ${envVar}`,
    body,
    envVar,
  };
}
