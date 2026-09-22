// Static analyzer for unauthenticated Next.js route handlers and server
// actions. Issue #65.
//
// Kelp reads Supabase RLS from migrations, but the leak often lives one layer
// up: an `app/api/orders/route.ts` that queries the DB with no `auth.getUser()`
// call, a `pages/api/*` handler that trusts whatever the client sends, or a
// `"use server"` action that reads `formData` and writes without checking who
// is calling. Those are among the most common shapes a vibe-coded leak takes,
// and they are invisible to the SQL analyzer.
//
// This is deliberately heuristic. There is no type information here and auth
// can be enforced in a dozen ways (middleware, a wrapper HOF, a helper in
// another file), so every finding is `confidence: medium` and the analyzer errs
// toward silence:
//
//   - If the file contains ANY recognized auth signal, none of its handlers are
//     flagged. A route with two handlers where only one checks auth will be a
//     false negative, not a false positive. We would rather miss than cry wolf.
//   - Signature-verified webhooks (Stripe `constructEvent`, svix, an HMAC over
//     `x-hub-signature`) are a legitimate no-session pattern, so a verification
//     signal counts as auth.
//   - GET handlers are only flagged when the file also shows a backend/data
//     access signal, so a public health check or an echo route stays quiet.
//     Mutations (POST/PUT/PATCH/DELETE) are flagged with no data gate: a write
//     endpoint with no auth is almost never intentional.
//
// The analyzer runs on the same in-memory `SourceFile[]` as the secret scanner,
// so it costs nothing beyond a regex pass and needs no live target.

import type { Severity } from "../types.js";
import type { SourceFile } from "./secrets.js";
import { fingerprint } from "../fingerprint.js";

export type NextjsRouteIssue = "route_handler_no_auth" | "server_action_no_auth";

export interface NextjsRouteFinding {
  fingerprint: string;
  issue: NextjsRouteIssue;
  severity: Severity;
  confidence: "medium";
  /** Repo-relative file path. */
  path: string;
  /** 1-indexed line of the handler / action export. */
  line: number;
  /** HTTP method for route handlers ("GET", "POST", …) or "ANY" for a
   *  legacy pages/api default handler. Undefined for server actions. */
  method?: string;
  /** Exported action name for server actions. Undefined for routes. */
  name?: string;
  title: string;
  explanation: string;
}

// ── signals ─────────────────────────────────────────────────────────────

// Anything here means "this file already establishes who the caller is".
// Kept broad on purpose: a false auth signal only costs us a missed finding,
// which is the safe direction for a medium-confidence heuristic.
const AUTH_SIGNALS: RegExp[] = [
  /\bgetUser\b/,
  /\bgetSession\b/,
  /\bgetServerSession\b/,
  /\bunstable_getServerSession\b/,
  /\bgetServerAuthSession\b/,
  /\brequireUser\b/,
  /\brequireAuth\b/,
  /\brequireSession\b/,
  /\bensureAuth\w*/,
  /\bcheckAuth\w*/,
  /\bcurrentUser\b/,
  /\bgetAuth\b/,
  /\bgetToken\b/,
  /\bverifyJwt\b/,
  /\bverifyToken\b/,
  /\bverifyIdToken\b/,
  /\bauthorize\b/,
  /\bwithApiAuth\w*/,
  /\bwithAuth\b/,
  /supabase\.auth/,
  /createRouteHandlerClient/,
  /createServerComponentClient/,
  /\bsession\s*[?.]/,
  /\bclerkClient\b/,
  // `auth()` (Clerk / NextAuth v5) or `auth(` used as a guard.
  /\bauth\s*\(/,
];

// Webhook signature verification: a legitimate reason to have no session.
const SIGNATURE_SIGNALS: RegExp[] = [
  /constructEvent/,
  /verifySignature/i,
  /stripe-signature/i,
  /x-hub-signature/i,
  /\bsvix\b/i,
  /timingSafeEqual/,
  /webhook[_-]?secret/i,
];

// Backend / data access. Gates GET handlers (reads) so trivial public routes
// don't get flagged. Not required for mutations.
const DATA_SIGNALS: RegExp[] = [
  /supabase/i,
  /\bprisma\b/i,
  /\bdrizzle\b/i,
  /\bmongoose\b/i,
  /\bmongodb\b/i,
  /\bdb\s*\./,
  /\.from\s*\(/,
  /sql`/,
  /\bcreateClient\b/,
  /service_role/,
  /\.query\s*\(/,
  /\bknex\b/i,
  /\bredis\b/i,
];

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function anyMatch(signals: RegExp[], text: string): boolean {
  return signals.some((re) => re.test(text));
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

// ── file classification ─────────────────────────────────────────────────

const APP_ROUTE_RE = /(?:^|\/)app\/(?:.*\/)?route\.[tj]sx?$/i;
const PAGES_API_RE = /(?:^|\/)pages\/api\/.+\.[tj]sx?$/i;

function isAppRouteFile(path: string): boolean {
  return APP_ROUTE_RE.test(path);
}
function isPagesApiFile(path: string): boolean {
  return PAGES_API_RE.test(path);
}
function isSourceFile(path: string): boolean {
  return /\.[tj]sx?$/i.test(path);
}
function hasUseServerDirective(content: string): boolean {
  // Module-level or in-function "use server" / 'use server'.
  return /["']use server["']/.test(content);
}

// ── handler / action export detection ───────────────────────────────────

// `export async function GET(` / `export function POST(`
const FN_EXPORT_RE =
  /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g;
// `export const GET = ` / `export const POST: ... =`
const CONST_EXPORT_RE =
  /export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*(?::[^=]+)?=/g;
// legacy pages/api default handler
const DEFAULT_EXPORT_RE = /export\s+default\s+(?:async\s+)?(?:function|\()/g;

interface HandlerHit {
  method: string;
  index: number;
}

function findRouteHandlers(content: string, legacy: boolean): HandlerHit[] {
  const hits: HandlerHit[] = [];
  const seen = new Set<string>();
  for (const re of [FN_EXPORT_RE, CONST_EXPORT_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      const key = `${m[1]}@${m.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ method: m[1]!, index: m.index });
    }
  }
  if (legacy && hits.length === 0) {
    DEFAULT_EXPORT_RE.lastIndex = 0;
    const m = DEFAULT_EXPORT_RE.exec(content);
    if (m) hits.push({ method: "ANY", index: m.index });
  }
  return hits;
}

// `export async function foo(` / `export const foo = async (`
const ACTION_FN_RE = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g;
const ACTION_CONST_RE =
  /export\s+const\s+([A-Za-z0-9_$]+)\s*(?::[^=]+)?=\s*async\b/g;

interface ActionHit {
  name: string;
  index: number;
}

function findServerActions(content: string): ActionHit[] {
  const hits: ActionHit[] = [];
  const seen = new Set<string>();
  for (const re of [ACTION_FN_RE, ACTION_CONST_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      const name = m[1]!;
      if (seen.has(name)) continue;
      seen.add(name);
      hits.push({ name, index: m.index });
    }
  }
  return hits;
}

// ── analyzer ────────────────────────────────────────────────────────────

/** Scan the repo for unauthenticated Next.js route handlers and server
 *  actions. Pure over the in-memory file set. */
export function analyzeNextjsRoutes(files: readonly SourceFile[]): NextjsRouteFinding[] {
  const findings: NextjsRouteFinding[] = [];

  for (const f of files) {
    if (!isSourceFile(f.path)) continue;
    const content = f.content;

    const authed = anyMatch(AUTH_SIGNALS, content) || anyMatch(SIGNATURE_SIGNALS, content);
    const hasData = anyMatch(DATA_SIGNALS, content);

    // 1) Route handlers (app router + legacy pages/api).
    const isRoute = isAppRouteFile(f.path) || isPagesApiFile(f.path);
    if (isRoute && !authed) {
      const legacy = isPagesApiFile(f.path);
      for (const h of findRouteHandlers(content, legacy)) {
        const mutating = MUTATING.has(h.method) || h.method === "ANY";
        // Reads (GET) only when the file actually touches a backend.
        if (!mutating && !hasData) continue;
        const severity: Severity = mutating ? "medium" : "low";
        const label = h.method === "ANY" ? "handler" : `${h.method} handler`;
        findings.push({
          fingerprint: fingerprint(["nextjs-route", "no-auth", f.path, h.method]),
          issue: "route_handler_no_auth",
          severity,
          confidence: "medium",
          path: f.path,
          line: lineOf(content, h.index),
          method: h.method,
          title: `Next.js ${label} in ${f.path} has no auth check`,
          explanation:
            `The ${label} exports from ${f.path} with no recognized ` +
            `authentication call (getUser, getSession, a requireUser helper, ` +
            `or a verified webhook signature). ` +
            (mutating
              ? `A mutation reachable without a session lets any caller write ` +
                `on behalf of anyone. `
              : `The file reads from a backend, so an unauthenticated GET can ` +
                `leak other users' data. `) +
            `Gate the handler on the caller's identity, or confirm the route ` +
            `is intentionally public.`,
        });
      }
    }

    // 2) Server actions ("use server" files).
    if (hasUseServerDirective(content) && !authed) {
      const readsFormData = /\bformData\b/.test(content);
      if (readsFormData || hasData) {
        for (const a of findServerActions(content)) {
          findings.push({
            fingerprint: fingerprint(["nextjs-action", "no-auth", f.path, a.name]),
            issue: "server_action_no_auth",
            severity: "medium",
            confidence: "medium",
            path: f.path,
            line: lineOf(content, a.index),
            name: a.name,
            title: `Server action ${a.name}() in ${f.path} has no auth check`,
            explanation:
              `${a.name}() is a "use server" action that ` +
              (readsFormData ? `reads formData ` : `touches a backend `) +
              `with no recognized authentication call. Server actions are ` +
              `public POST endpoints: anyone can invoke them with a crafted ` +
              `request. Verify the caller's session and authorize the write ` +
              `before trusting any input.`,
          });
        }
      }
    }
  }

  // Deterministic order: severity first, then path/line.
  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  findings.sort(
    (a, b) => order[a.severity] - order[b.severity] || a.path.localeCompare(b.path) || a.line - b.line,
  );
  return findings;
}
