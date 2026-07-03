// Builds the actual file edit for a secret-fix PR: replace the hard-coded
// secret with a `process.env.X` reference at the finding's location.
//
// Deterministic and conservative: we only rewrite JS/TS-family files where the
// secret appears as a complete quoted string literal, so the edit is guaranteed
// syntactically valid. Anything else (config files, secrets embedded inside a
// longer string, .env files) returns null and the user falls back to the
// fix-prompt. The hard guarantee: the returned content NEVER contains the
// secret value — if we can't fully remove it, we refuse to produce a fix.

import type { SecretFinding, SourceFile } from "../scanners/secrets.js";
import { locateSecret } from "../scanners/secrets.js";
import { suggestedEnvVar } from "./secret-pr.js";

// Files where `process.env.X` is a valid expression.
const JS_FAMILY_RE = /\.(?:js|jsx|ts|tsx|mjs|cjs)$/i;

export interface SecretFixEdit {
  /** full new file content, with every occurrence of the secret removed */
  content: string;
  /** env var the secret was moved to */
  envVar: string;
}

/**
 * Replace the detected secret in `file` with a `process.env.X` reference.
 * Returns null when a safe automatic edit isn't possible: the secret is gone
 * (already fixed), the file isn't JS/TS, or the value survives somewhere in
 * the file after the rewrite.
 */
export function applySecretFix(
  file: SourceFile,
  finding: Pick<SecretFinding, "fingerprint" | "ruleId">,
): SecretFixEdit | null {
  if (!JS_FAMILY_RE.test(file.path)) return null;

  const located = locateSecret(file, finding.fingerprint);
  if (!located) return null;

  const { value } = located;
  const envVar = suggestedEnvVar(finding.ruleId);

  // Replace every occurrence where the secret is a complete quoted literal.
  // Same value elsewhere in the file shares the fingerprint (it's mask-based),
  // so one finding covers them all.
  let content = file.content;
  for (const q of ['"', "'", "`"]) {
    content = content.split(`${q}${value}${q}`).join(`process.env.${envVar}`);
  }

  // Refuse partial fixes: if the value still appears anywhere (unquoted, or
  // embedded inside a longer string), a PR from this edit would still leak it.
  if (content === file.content || content.includes(value)) return null;

  return { content, envVar };
}
