// Static analyzer for CORS misconfiguration.
//
// The dangerous cases, in order:
//
//   cors_reflect_credentials (critical) — the response reflects the request's
//     Origin header AND sets Access-Control-Allow-Credentials: true. Any
//     website the victim visits can then make credentialed cross-origin reads
//     of the victim's data. This is the real, exploitable CORS bug.
//
//   cors_wildcard_credentials (high) — Access-Control-Allow-Origin: * together
//     with credentials: true. Browsers reject this exact combo, but it is a
//     loud misconfiguration that is almost always "fixed" by switching to
//     origin reflection (the critical case above), so it is worth flagging.
//
//   cors_wildcard (medium) — Access-Control-Allow-Origin: * with no
//     credentials. Fine for a genuinely public, unauthenticated API; a smell
//     on anything that serves user data, since every origin can read it.
//
// Detection is lexical: it finds where Access-Control-Allow-Origin is set (in
// a route handler, an edge function, next.config headers, or a res.setHeader
// call), reads the value, and checks the file for a credentials-true header.
// A hardcoded allowlisted origin (a quoted https URL, or an env var) is safe
// and never flagged.

import type { Severity } from "../types.js";
import type { SourceFile } from "./secrets.js";
import { fingerprint } from "../fingerprint.js";

export type CorsIssue =
  | "cors_reflect_credentials"
  | "cors_wildcard_credentials"
  | "cors_wildcard";

export interface CorsFinding {
  fingerprint: string;
  issue: CorsIssue;
  severity: Severity;
  confidence: "high" | "medium";
  path: string;
  line: number;
  title: string;
  explanation: string;
}

function isSourceish(path: string): boolean {
  // Route handlers, edge fns, next.config, plain config. Skip lockfiles etc.
  if (/-lock\.(?:json|ya?ml)$/i.test(path)) return false;
  return /\.[cm]?[jt]sx?$/i.test(path) || /\.(?:json|toml)$/i.test(path);
}

// The header key, then a ":" (object literal / config) or "," (setHeader /
// headers.set), then the value up to a delimiter.
const ACAO_RE =
  /["']access-control-allow-origin["']\s*[:,]\s*([^\n,;)}\]]+)/gi;

const CREDS_RE =
  /["']?access-control-allow-credentials["']?\s*[:,]\s*["']?true\b/i;

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

type Kind = "wildcard" | "reflect" | "safe";

function classifyValue(raw: string): Kind {
  const v = raw.trim().replace(/[)\]}]+$/, "").trim();
  // Strip one layer of surrounding quotes/backticks.
  const unquoted = v.replace(/^["'`]|["'`]$/g, "").trim();

  if (unquoted === "*") return "wildcard";

  // A hardcoded origin literal (quoted https URL) is an allowlisted origin.
  if (/^["'`]?https?:\/\//i.test(v)) return "safe";

  // Reflection: the value is an expression that reads the request Origin, or a
  // bare `origin`-named variable / template using it.
  if (
    /req\.headers|request\.headers|headers\.get|headers\[|\borigin\b/i.test(v) &&
    !/^["'`]/.test(v) // not a plain string literal
  ) {
    return "reflect";
  }
  // A quoted string that isn't "*" or a URL (e.g. an env-substituted value) is
  // treated as safe: it is a specific configured origin, not a wildcard.
  return "safe";
}

/** Scan the repo for CORS misconfigurations. Pure over the file set. */
export function analyzeCors(files: readonly SourceFile[]): CorsFinding[] {
  const findings: CorsFinding[] = [];

  for (const f of files) {
    if (!isSourceish(f.path)) continue;
    const content = f.content;
    const creds = CREDS_RE.test(content);

    const seen = new Set<number>();
    ACAO_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ACAO_RE.exec(content))) {
      const kind = classifyValue(m[1]!);
      if (kind === "safe") continue;

      let issue: CorsIssue;
      let severity: Severity;
      let confidence: "high" | "medium";
      if (kind === "reflect") {
        if (!creds) continue; // reflected origin without credentials is low-signal.
        issue = "cors_reflect_credentials";
        severity = "critical";
        confidence = "high";
      } else if (creds) {
        issue = "cors_wildcard_credentials";
        severity = "high";
        confidence = "high";
      } else {
        issue = "cors_wildcard";
        severity = "medium";
        confidence = "medium";
      }

      const line = lineOf(content, m.index);
      if (seen.has(line)) continue;
      seen.add(line);

      const title =
        issue === "cors_reflect_credentials"
          ? `CORS reflects the request Origin with credentials in ${f.path}`
          : issue === "cors_wildcard_credentials"
            ? `CORS allows any origin (*) with credentials in ${f.path}`
            : `CORS allows any origin (*) in ${f.path}`;

      const explanation =
        issue === "cors_reflect_credentials"
          ? `The response echoes the request's Origin header into ` +
            `Access-Control-Allow-Origin and also sets ` +
            `Access-Control-Allow-Credentials: true. Any site the victim visits ` +
            `can make credentialed cross-origin requests and read the response, ` +
            `so it can steal authenticated data. Reflect only origins on an ` +
            `explicit allowlist, and never reflect an arbitrary Origin with ` +
            `credentials enabled.`
          : issue === "cors_wildcard_credentials"
            ? `Access-Control-Allow-Origin is "*" while ` +
              `Access-Control-Allow-Credentials is true. Browsers reject this ` +
              `exact combination, so it usually gets "fixed" by reflecting the ` +
              `Origin instead, which is the exploitable bug. Set a specific ` +
              `allowlisted origin instead of "*".`
            : `Access-Control-Allow-Origin is "*", so any website can read this ` +
              `endpoint's responses cross-origin. Fine for a genuinely public, ` +
              `unauthenticated API; on anything that returns user data, restrict ` +
              `it to an allowlist of known origins.`;

      findings.push({
        fingerprint: fingerprint(["cors", issue, f.path, String(line)]),
        issue,
        severity,
        confidence,
        path: f.path,
        line,
        title,
        explanation,
      });
    }
  }

  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  findings.sort(
    (a, b) => order[a.severity] - order[b.severity] || a.path.localeCompare(b.path) || a.line - b.line,
  );
  return findings;
}
