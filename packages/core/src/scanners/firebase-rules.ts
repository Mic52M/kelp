// Static analyzer for Firebase Security Rules (Firestore + Cloud Storage).
// Issue #38 — the detection payload behind the Firebase backend adapter.
//
// Firebase is the second backend Kelp understands (after Supabase). Where a
// Supabase app gates data with Postgres RLS, a Firebase app gates it with a
// `.rules` file: a small DSL of `match` blocks and `allow <ops>: if <cond>`
// statements. Vibe-coded Firebase apps get this wrong in a few reliable ways,
// and all of them are visible in the repo source with no live project:
//
//   FIREBASE-01  firebase_rule_public — `allow ...: if true`. The collection
//                or bucket path is open to the entire internet. Critical when
//                it grants a write, high when it is a public read.
//
//   FIREBASE-02  firebase_rule_unauthenticated_write — a write/create/update/
//                delete allowed by a condition that never references
//                `request.auth`. Anyone, signed in or not, can write as long
//                as they satisfy some non-auth constraint.
//
//   FIREBASE-03  firebase_rule_write_no_owner — a write gated on the caller
//                being signed in (`request.auth != null`) but with no binding
//                to the document owner. Every authenticated user can overwrite
//                every other user's data. The Firebase equivalent of an RLS
//                policy that checks the JWT exists but not `auth.uid()`.
//
// This is a lexical evaluator, not a full rules interpreter. The rules
// language has user-defined `function` helpers we cannot follow, so the
// analyzer errs toward silence: a condition that calls a local function is
// treated as opaque-but-guarded and only the unambiguous `if true` is flagged
// through it. FIREBASE-02/03 are `confidence: medium` for the same reason;
// the literal-true FIREBASE-01 is `confidence: high`.

import type { Severity } from "../types.js";
import type { SourceFile } from "./secrets.js";
import { fingerprint } from "../fingerprint.js";

export type FirebaseRuleIssue =
  | "firebase_rule_public"
  | "firebase_rule_unauthenticated_write"
  | "firebase_rule_write_no_owner";

export type FirebaseRuleService = "firestore" | "storage";

export interface FirebaseRuleFinding {
  fingerprint: string;
  issue: FirebaseRuleIssue;
  severity: Severity;
  confidence: "high" | "medium";
  service: FirebaseRuleService;
  /** Repo-relative path of the .rules file. */
  path: string;
  /** 1-indexed line of the `allow` statement. */
  line: number;
  /** The enclosing `match` path, e.g. "/users/{userId}". */
  matchPath: string;
  /** The operations the statement grants, e.g. ["read", "write"]. */
  ops: string[];
  title: string;
  explanation: string;
}

const WRITE_OPS = new Set(["write", "create", "update", "delete"]);

function isRulesFile(path: string): boolean {
  return /\.rules$/i.test(path) || /(?:^|\/)(?:firestore|storage)\.rules$/i.test(path);
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

// Last `service <name>` block opened before `index` decides firestore vs
// storage. Falls back to the filename when the file has no service header
// (some repos split rules and rely on firebase.json to assign them).
function serviceAt(content: string, index: number, path: string): FirebaseRuleService {
  const before = content.slice(0, index);
  const storage = before.lastIndexOf("firebase.storage");
  const firestore = before.lastIndexOf("cloud.firestore");
  if (storage === -1 && firestore === -1) {
    return /storage/i.test(path) ? "storage" : "firestore";
  }
  return storage > firestore ? "storage" : "firestore";
}

// Nearest enclosing `match <path>` before the allow statement. Used for the
// finding location label and the fingerprint, not for evaluation.
const MATCH_RE = /match\s+(\S+)\s*\{/g;
function matchPathAt(content: string, index: number): string {
  let best = "/";
  MATCH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MATCH_RE.exec(content)) && m.index < index) {
    best = m[1]!;
  }
  return best;
}

const ALLOW_RE = /allow\s+([a-z,\s]+?)\s*:\s*if\b([\s\S]*?);/gi;
const FUNCTION_DEF_RE = /function\s+([A-Za-z0-9_]+)\s*\(/g;

function collectFunctionNames(content: string): Set<string> {
  const names = new Set<string>();
  FUNCTION_DEF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FUNCTION_DEF_RE.exec(content))) names.add(m[1]!);
  return names;
}

function conditionCallsHelper(cond: string, helpers: Set<string>): boolean {
  for (const name of helpers) {
    if (new RegExp(`\\b${name}\\s*\\(`).test(cond)) return true;
  }
  return false;
}

function isPublicCondition(cond: string): boolean {
  const stripped = cond.replace(/\s/g, "");
  return (
    stripped === "true" ||
    stripped === "(true)" ||
    stripped.includes("||true") ||
    stripped.includes("true||")
  );
}

function referencesAuth(cond: string): boolean {
  if (!/request\.auth\b/.test(cond)) return false;
  // `request.auth == null` alone is an explicit-anonymous gate, not an auth
  // requirement. Only treat it as auth-required if there is a != null / uid use.
  if (/request\.auth\s*==\s*null/.test(cond) && !/request\.auth\s*!=\s*null/.test(cond) && !/request\.auth\.uid/.test(cond)) {
    return false;
  }
  return true;
}

function hasOwnerBinding(cond: string): boolean {
  return (
    /request\.auth\.uid\s*(==|!=|in)/.test(cond) ||
    /(==|\bin)\s*request\.auth\.uid/.test(cond) ||
    /resource\.data\./.test(cond) ||
    /request\.auth\.token\./.test(cond)
  );
}

/** Scan the repo's Firebase `.rules` files for the top misconfigurations.
 *  Pure over the in-memory file set, no live project needed. */
export function analyzeFirebaseRules(files: readonly SourceFile[]): FirebaseRuleFinding[] {
  const findings: FirebaseRuleFinding[] = [];

  for (const f of files) {
    if (!isRulesFile(f.path)) continue;
    const content = f.content;
    const helpers = collectFunctionNames(content);

    ALLOW_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ALLOW_RE.exec(content))) {
      const ops = m[1]!
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const cond = m[2]!.trim();
      if (ops.length === 0) continue;

      const hasWrite = ops.some((o) => WRITE_OPS.has(o));
      const service = serviceAt(content, m.index, f.path);
      const mp = matchPathAt(content, m.index);
      const line = lineOf(content, m.index);
      const opaque = conditionCallsHelper(cond, helpers);

      let issue: FirebaseRuleIssue | null = null;
      let severity: Severity = "medium";
      let confidence: "high" | "medium" = "medium";

      if (isPublicCondition(cond)) {
        issue = "firebase_rule_public";
        severity = hasWrite ? "critical" : "high";
        confidence = "high";
      } else if (hasWrite && !opaque) {
        if (!referencesAuth(cond)) {
          issue = "firebase_rule_unauthenticated_write";
          severity = "high";
          confidence = "medium";
        } else if (!hasOwnerBinding(cond)) {
          issue = "firebase_rule_write_no_owner";
          severity = "high";
          confidence = "medium";
        }
      }

      if (!issue) continue;

      const opList = ops.join(", ");
      const svcLabel = service === "storage" ? "Storage" : "Firestore";
      const title =
        issue === "firebase_rule_public"
          ? `${svcLabel} rule on ${mp} is public (allow ${opList}: if true)`
          : issue === "firebase_rule_unauthenticated_write"
            ? `${svcLabel} write rule on ${mp} needs no authentication`
            : `${svcLabel} write rule on ${mp} has no owner check`;

      const explanation =
        issue === "firebase_rule_public"
          ? `The rule "allow ${opList}: if true" on ${mp} grants ${
              hasWrite ? "writes" : "reads"
            } to anyone on the internet, with no authentication. ` +
            (hasWrite
              ? `Any caller can overwrite or delete every document in this path. `
              : `Any caller can read every document in this path. `) +
            `Gate it on request.auth and, for user data, on the owner's uid.`
          : issue === "firebase_rule_unauthenticated_write"
            ? `The rule "allow ${opList}" on ${mp} never checks request.auth, so an ` +
              `unauthenticated caller can write as long as the other conditions ` +
              `pass. Require request.auth != null and bind the write to the ` +
              `document owner (request.auth.uid) before trusting it.`
            : `The rule "allow ${opList}" on ${mp} requires the caller to be signed in ` +
              `but never ties the write to the document owner, so any ` +
              `authenticated user can overwrite anyone else's data. Add an ` +
              `ownership check, e.g. request.auth.uid == userId or a ` +
              `resource.data owner field.`;

      findings.push({
        fingerprint: fingerprint(["firebase-rule", issue, f.path, mp, opList]),
        issue,
        severity,
        confidence,
        service,
        path: f.path,
        line,
        matchPath: mp,
        ops,
        title,
        explanation,
      });
    }
  }

  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  findings.sort(
    (a, b) =>
      order[a.severity] - order[b.severity] ||
      a.path.localeCompare(b.path) ||
      a.line - b.line,
  );
  return findings;
}
