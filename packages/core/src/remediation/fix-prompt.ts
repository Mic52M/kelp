// Fix-prompt generator — Kelp's differentiating remediation output.
//
// Our users built their app WITH an AI coding tool (Lovable, Bolt, Cursor, v0,
// Replit). For them the most natural fix isn't a git diff — it's a ready-to-paste
// prompt they hand back to that tool. This module turns a finding into exactly
// that: a precise, self-contained instruction the AI tool can act on, phrased so
// a non-security founder can use it without understanding the internals.
//
// Deterministic and testable. Later, the agentic layer can enrich these with
// project-specific context, but the templates here are the reliable backbone.

import type { SecretFinding } from "../scanners/secrets.js";
import type { RlsFinding } from "../scanners/rls.js";
import type { BolaReport } from "./bola-report.js";
import { generateRlsMigration } from "../scanners/rls.js";
import { suggestedEnvVar } from "./secret-pr.js";

export type AiTool = "lovable" | "bolt" | "cursor" | "v0" | "replit" | "generic";

const TOOL_LABEL: Record<AiTool, string> = {
  lovable: "Lovable",
  bolt: "Bolt",
  cursor: "Cursor",
  v0: "v0",
  replit: "Replit",
  generic: "your AI coding tool",
};

function intro(tool: AiTool): string {
  // Kept for backward-compat with callers that expect a lead-in; new UI
  // renders its own "Or fix it with your AI tool" heading + "Paste into
  // Lovable / Bolt / Cursor / v0" hint, so we skip the redundant preface.
  void tool;
  return "";
}

/** Fix prompt for an exposed secret. */
export function fixPromptForSecret(finding: SecretFinding, _tool: AiTool = "generic"): string {
  const envVar = suggestedEnvVar(finding.ruleId);
  const rotate =
    finding.severity === "critical"
      ? ` Then remind me to rotate the ${finding.provider} key, since it was exposed and must be considered compromised.`
      : "";
  return (
    `There is a hard-coded ${finding.provider} secret in \`${finding.path}\` on line ` +
    `${finding.line}. Move it out of the code: read it from an environment variable ` +
    `named \`${envVar}\` instead, update every place that uses it, and make sure the ` +
    `value is never sent to the browser. Add \`${envVar}\` to my \`.env\` (and to my ` +
    `deployment's environment variables) with a placeholder, and do not commit the real ` +
    `value.${rotate}`
  );
}

/** Fix prompt for a missing/weak RLS configuration. */
export function fixPromptForRls(finding: RlsFinding, _tool: AiTool = "generic"): string {
  const owner = finding.ownershipColumn;
  const migration =
    finding.fixable && owner
      ? generateRlsMigration({ schema: finding.schema, name: finding.table }, owner)
      : null;

  return migration !== null
    ? `The Supabase table \`${finding.schema}.${finding.table}\` is not secured: ` +
      `${finding.issue === "rls_disabled" ? "Row Level Security is turned off" : "a policy lets any user access every row"}. ` +
      `Apply this migration so each user can only access their own rows (via ` +
      `\`auth.uid() = ${owner}\`), and confirm the app still works for a logged-in ` +
      `user:\n\n${migration}`
    : `The Supabase table \`${finding.schema}.${finding.table}\` needs Row Level ` +
      `Security. Enable RLS and add policies so a user can only read and modify ` +
      `rows that belong to them. Tell me which column identifies the owner if it's ` +
      `not obvious, and write the policies for select, insert, update and delete.`;
}

/** Fix prompt for a BOLA / broken object-level authorization finding. */
export function fixPromptForBola(report: BolaReport, tool: AiTool = "generic"): string {
  return (
    `${intro(tool)}\n\n` +
    `"The endpoint \`${report.endpoint}\` lets a logged-in user access another user's ` +
    `data by changing the ID in the request. Add an authorization check so a user can ` +
    `only access records they own — ideally with a Supabase Row Level Security policy ` +
    `that checks \`auth.uid()\` against the owner column, or an ownership check in the ` +
    `API before returning the record. Then verify that a second test user can no longer ` +
    `read the first user's records."`
  );
}
