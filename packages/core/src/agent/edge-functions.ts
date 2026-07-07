// Supabase Edge Function discovery (Stage B of #27).
//
// The vibe-coding stack (Lovable / Bolt / v0 on Supabase) ships a static SPA
// plus hand-written backend logic as Supabase Edge Functions — Deno handlers
// under `supabase/functions/<name>/index.ts`, deployed at
// `https://<ref>.supabase.co/functions/v1/<name>`. Unlike PostgREST (generated,
// parameterized), these are hand-written and are where the real auth-bypass /
// injection / SSRF bugs of these apps live.
//
// This module is pure, deterministic parsing (regex, not a full TS AST) over
// the repo's source files — no network, fully unit-testable in core. It returns
// a structured description of each function: its deploy name, the params it
// reads, a read-only-vs-mutating classification, and capability hints the
// specialists use to decide what to probe.
//
// SAFETY: classification errs on the side of "mutating". The customer path only
// probes functions this module marks NON-mutating, so a false "mutating" just
// means we skip a safe function (under-probe) — never that we call a
// destructive one (delete-account, create-payment-checkout, …).

import type { SourceFile } from "../scanners/secrets.js";

export interface DiscoveredEdgeFunction {
  /** deploy name, e.g. "check-subscription" (the folder under functions/) */
  name: string;
  /** repo path of the handler */
  path: string;
  /** params destructured from `await req.json()` (best-effort) */
  bodyParams: string[];
  /** params read via `searchParams.get("x")` (best-effort) */
  queryParams: string[];
  /** true = performs writes / charges / admin ops → never probed in Stage B */
  mutating: boolean;
  /** why we classified it mutating (for the report / debugging), else null */
  mutationReason: string | null;
  /** param names that look like a user/resource identity (auth-bypass target) */
  identityParams: string[];
  /** param names that look like a URL (SSRF target) */
  urlParams: string[];
}

/** Folder name → deploy name; `_shared` and dotfiles are not functions. */
const FUNCTION_PATH = /(?:^|\/)supabase\/functions\/([^/]+)\/index\.[cm]?tsx?$/;

// A function is treated as MUTATING (and therefore skipped) if its name starts
// with a write-ish verb, OR its body contains a write/charge/admin call. Kept
// deliberately broad — false "mutating" only costs coverage, never safety.
const MUTATING_NAME = /^(delete|remove|cancel|create|add|update|set|upsert|insert|charge|refund|revoke|reset|send|purge|drop|sync|import|migrate|invite|approve|reject|assign|grant|activate|deactivate|disable|enable|process|confirm|complete|finalize|generate|regenerate|rotate|issue|redeem|apply|submit|save|store|write|post|put|patch)\b/i;

const MUTATING_BODY_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\.\s*(insert|update|upsert|delete)\s*\(/, reason: "writes to the database" },
  { re: /auth\s*\.\s*admin\s*\.\s*(create|delete|update|invite)/i, reason: "calls Supabase admin user mutations" },
  { re: /stripe[\s\S]{0,80}?\.\s*(create|cancel|update|del|refund)/i, reason: "performs a Stripe mutation" },
  { re: /checkout\s*\.\s*sessions\s*\.\s*create/i, reason: "creates a Stripe checkout session" },
  { re: /subscriptions\s*\.\s*(create|cancel|update|del)/i, reason: "mutates a Stripe subscription" },
  { re: /\.\s*(sendEmail|send_email|sendMail)\s*\(/i, reason: "sends email" },
];

const IDENTITY_PARAM = /^(.*_)?(user_?id|userid|account_?id|owner_?id|profile_?id|target_?user|target_?id|customer_?id|email|uid)$/i;
const URL_PARAM = /^(.*_)?(url|uri|endpoint|webhook|callback|link|href|redirect|redirect_?uri|image_?url|avatar_?url|fetch_?url|source_?url|target_?url)$/i;

/** Extract `{ a, b, c }` destructured from `await req.json()` / `req.json()`. */
function extractBodyParams(src: string): string[] {
  const out = new Set<string>();
  // const { a, b, c } = await req.json();  (also: = await req.json() as T)
  const re = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:await\s+)?(?:req|request)\s*\.\s*json\s*\(\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    for (const raw of m[1]!.split(",")) {
      // handle `a`, `a: b`, `a = default`, `...rest`
      const name = raw.split(/[:=]/)[0]!.replace(/\.\.\./, "").trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) out.add(name);
    }
  }
  return [...out];
}

/** Extract `searchParams.get("x")` param names. */
function extractQueryParams(src: string): string[] {
  const out = new Set<string>();
  const re = /searchParams\s*\.\s*get\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.add(m[1]!);
  return [...out];
}

function classifyMutating(name: string, src: string): { mutating: boolean; reason: string | null } {
  if (MUTATING_NAME.test(name)) {
    return { mutating: true, reason: `name starts with a write verb ("${name.split("-")[0]}")` };
  }
  for (const p of MUTATING_BODY_PATTERNS) {
    if (p.re.test(src)) return { mutating: true, reason: p.reason };
  }
  return { mutating: false, reason: null };
}

/**
 * Discover the Supabase Edge Functions in a repo's source files. Deterministic
 * and side-effect-free. `_shared` helpers and non-index files are ignored.
 */
export function discoverEdgeFunctions(
  files: readonly SourceFile[],
): DiscoveredEdgeFunction[] {
  const out: DiscoveredEdgeFunction[] = [];
  for (const f of files) {
    const m = f.path.match(FUNCTION_PATH);
    if (!m) continue;
    const name = m[1]!;
    if (name === "_shared" || name.startsWith("_") || name.startsWith(".")) continue;

    const bodyParams = extractBodyParams(f.content);
    const queryParams = extractQueryParams(f.content);
    const allParams = [...new Set([...bodyParams, ...queryParams])];
    const { mutating, reason } = classifyMutating(name, f.content);

    out.push({
      name,
      path: f.path,
      bodyParams,
      queryParams,
      mutating,
      mutationReason: reason,
      identityParams: allParams.filter((p) => IDENTITY_PARAM.test(p)),
      urlParams: allParams.filter((p) => URL_PARAM.test(p)),
    });
  }
  // Stable order for reproducible campaigns/reports.
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** The deployed URL for a discovered function on a given project ref. */
export function edgeFunctionUrl(ref: string, name: string): string {
  return `https://${ref}.supabase.co/functions/v1/${name}`;
}
