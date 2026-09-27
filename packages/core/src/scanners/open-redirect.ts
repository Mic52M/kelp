// Static analyzer for open redirects.
//
// The canonical vibe-coded shape is an auth callback that bounces the user to
// wherever a query param points, with no allowlist:
//
//   const next = searchParams.get("next");
//   redirect(next);                       // next/navigation
//   return NextResponse.redirect(next);   // route handler
//   res.redirect(req.query.returnTo);     // pages/api
//   window.location.href = params.get("redirect"); // client
//
// An attacker sends `?next=https://evil.example`, the victim lands on the
// phishing page from the trusted domain, and in an OAuth flow the redirect can
// carry the code/token off-site. Classic open redirect, and it is everywhere
// in AI-generated login/callback code.
//
// This is a lexical taint check, not a full data-flow analysis. It flags a
// redirect sink whose argument is a user-controlled source (directly, or via a
// local variable assigned from one). It errs toward silence: if the file shows
// a redirect-validation guard (a relative-path check, an origin comparison, or
// an allowlist), the findings in that file are suppressed. Every finding is
// `confidence: medium` when it goes through a variable, `high` when the source
// is inline in the sink.

import type { Severity } from "../types.js";
import type { SourceFile } from "./secrets.js";
import { fingerprint } from "../fingerprint.js";

export interface OpenRedirectFinding {
  fingerprint: string;
  ruleId: "open_redirect";
  severity: Severity;
  confidence: "high" | "medium";
  path: string;
  line: number;
  /** The redirect sink, e.g. "redirect", "NextResponse.redirect". */
  sink: string;
  title: string;
  explanation: string;
}

function isSourceFile(path: string): boolean {
  return /\.[cm]?[jt]sx?$/i.test(path);
}

// User-controlled request inputs that must not flow into a redirect unchecked.
const USER_SOURCE =
  /searchParams|nextUrl|req\.query|request\.query|params\.get\s*\(|URLSearchParams|location\.search|req\.body|request\.body/;

// A redirect-validation guard anywhere in the file suppresses its findings.
// Relative-path check, origin comparison, or a named allowlist/validator.
const GUARD =
  /startsWith\s*\(\s*["'`]\/["'`]\s*\)|\.origin\b|allow-?list|allowlist|allowedRedirects?|whitelist|safeRedirect|isValidRedirect|validateRedirect|sanitizeRedirect|isRelative/i;

// Call-form sinks: capture the sink name and the index just after "(".
const CALL_SINK_RE =
  /\b(redirect|permanentRedirect|(?:NextResponse|Response)\.redirect|res\.redirect|location\.(?:assign|replace))\s*\(/g;
// Assignment-form sinks: window.location / location.href = <value>.
const ASSIGN_SINK_RE = /\b((?:window\.)?location(?:\.href)?)\s*=\s*(?!=)/g;

// A local variable assigned from a user source becomes tainted.
const TAINT_DECL_RE = new RegExp(
  `(?:const|let|var)\\s+([A-Za-z0-9_$]+)\\s*=\\s*[^;\\n]*(?:${USER_SOURCE.source})`,
  "g",
);

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

/** Read a call argument list starting at the index just after "(". Returns
 *  the substring up to the matching ")". */
function readCallArg(content: string, openIdx: number): string {
  let depth = 1;
  let i = openIdx;
  for (; i < content.length && depth > 0; i++) {
    const c = content[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
  }
  return content.slice(openIdx, i - 1);
}

function readAssignValue(content: string, fromIdx: number): string {
  let i = fromIdx;
  for (; i < content.length; i++) {
    const c = content[i];
    if (c === ";" || c === "\n") break;
  }
  return content.slice(fromIdx, i);
}

// First bare identifier in an expression (the redirected value when it is just
// a variable reference).
function firstIdent(expr: string): string | null {
  const m = expr.match(/[A-Za-z_$][A-Za-z0-9_$]*/);
  return m ? m[0] : null;
}

function isAuthContext(path: string): boolean {
  return /(?:^|\/)(?:auth|login|signin|sign-in|callback|oauth|sso)(?:\/|\.|-)/i.test(path);
}

/** Scan the repo for open redirects. Pure over the in-memory file set. */
export function analyzeOpenRedirect(files: readonly SourceFile[]): OpenRedirectFinding[] {
  const findings: OpenRedirectFinding[] = [];

  for (const f of files) {
    if (!isSourceFile(f.path)) continue;
    const content = f.content;
    if (GUARD.test(content)) continue; // file has a redirect guard; stay quiet.

    // Collect tainted local variable names.
    const tainted = new Set<string>();
    TAINT_DECL_RE.lastIndex = 0;
    let d: RegExpExecArray | null;
    while ((d = TAINT_DECL_RE.exec(content))) tainted.add(d[1]!);

    const hits: { sink: string; index: number; arg: string }[] = [];

    CALL_SINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CALL_SINK_RE.exec(content))) {
      const arg = readCallArg(content, CALL_SINK_RE.lastIndex);
      hits.push({ sink: m[1]!, index: m.index, arg });
    }
    ASSIGN_SINK_RE.lastIndex = 0;
    while ((m = ASSIGN_SINK_RE.exec(content))) {
      const arg = readAssignValue(content, ASSIGN_SINK_RE.lastIndex);
      hits.push({ sink: m[1]!, index: m.index, arg });
    }

    const seen = new Set<number>();
    for (const h of hits) {
      if (seen.has(h.index)) continue;
      const direct = USER_SOURCE.test(h.arg);
      const viaVar = !direct && (() => {
        const id = firstIdent(h.arg.trim());
        return id ? tainted.has(id) : false;
      })();
      if (!direct && !viaVar) continue;
      seen.add(h.index);

      const line = lineOf(content, h.index);
      const auth = isAuthContext(f.path);
      const severity: Severity = auth ? "high" : "medium";
      const confidence: "high" | "medium" = direct ? "high" : "medium";
      findings.push({
        fingerprint: fingerprint(["open-redirect", f.path, h.sink, String(line)]),
        ruleId: "open_redirect",
        severity,
        confidence,
        path: f.path,
        line,
        sink: h.sink,
        title: `Open redirect: ${h.sink} follows a user-controlled URL in ${f.path}`,
        explanation:
          `${h.sink}() is fed a redirect target that comes from the request ` +
          `(a query param or request input) with no allowlist or relative-path ` +
          `check. An attacker can send a link to your domain that bounces the ` +
          `victim to an attacker-controlled site. ` +
          (auth
            ? `In an auth/callback flow this can also carry the OAuth code or ` +
              `token off-site. `
            : ``) +
          `Validate the target before redirecting: require it to start with a ` +
          `single "/" (a relative path), or check it against an allowlist of ` +
          `known hosts.`,
      });
    }
  }

  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  findings.sort(
    (a, b) => order[a.severity] - order[b.severity] || a.path.localeCompare(b.path) || a.line - b.line,
  );
  return findings;
}
