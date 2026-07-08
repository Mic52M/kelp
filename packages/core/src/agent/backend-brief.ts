// Deterministic pre-recon "backend brief" — the intelligence pack Kelp hands
// its autonomous agents up front, so they don't waste steps grepping the repo
// to answer questions we already know the answer to.
//
// The audit of usatopoint-test showed the failure mode: agent-data spent ~6 of
// its 22 steps hunting for the definition of `can_manage_products()` — a
// SECURITY DEFINER function referenced by RLS policies but defined in a
// migration the agent kept missing. Every step is one Anthropic round-trip.
// Extracting that information here — once, deterministically, from the same
// migrations + edge functions we already parse for other purposes — turns
// those wasted steps into attack time.
//
// This module is pure parsing over SourceFile[]. Unit-testable, zero network,
// zero LLM.

import type { SourceFile } from "../scanners/secrets.js";
import type { DiscoveredEdgeFunction } from "./edge-functions.js";

/** A Postgres function defined in one of the repo's migrations — the RPC
 *  surface + the trusted helpers RLS policies delegate to. SECURITY DEFINER
 *  functions bypass the caller's privileges by design, so they're the highest-
 *  signal target for authorization-bypass analysis. */
export interface RpcFunctionIntel {
  /** unqualified name, e.g. "has_role" */
  name: string;
  /** schema-qualified where the source gave one, else the bare name */
  qualifiedName: string;
  /** true when the function is declared SECURITY DEFINER */
  securityDefiner: boolean;
  /** true when a SET search_path is present — the standard mitigation for
   *  the DEFINER search-path attack. Absent → potential issue. */
  hasSetSearchPath: boolean;
  /** language: usually 'plpgsql', sometimes 'sql'. Lowercased. */
  language: string;
  /** the function body between `$$…$$` or `$tag$…$tag$`, trimmed. */
  body: string;
  /** which migration file it was defined in (most recent wins) */
  path: string;
}

/** Terse edge-function summary — enough for the agent to prioritize which
 *  ones to read fully, without needing to read them all first. */
export interface EdgeFunctionSummary {
  name: string;
  path: string;
  mutating: boolean;
  mutationReason: string | null;
  verifyJwt: boolean | null;
  bodyParams: string[];
  queryParams: string[];
  identityParams: string[];
  urlParams: string[];
}

/** The full brief handed to every agent as context. */
export interface BackendBrief {
  rpcFunctions: RpcFunctionIntel[];
  edgeFunctions: EdgeFunctionSummary[];
  /** Human-readable render — this is what actually gets inlined into the
   *  agent's initial prompt. Kept separate so tests can assert on structure
   *  while the prompt-facing text stays tweakable. */
  humanText: string;
}

// ─── RPC extraction ──────────────────────────────────────────────────────────

/** Match CREATE [OR REPLACE] FUNCTION … up to (but not including) the body
 *  opener ($$ or $tag$). Captures the schema-qualified name. */
const FN_HEADER_RE =
  /create\s+(?:or\s+replace\s+)?function\s+((?:"?[\w$]+"?\.)?"?[\w$]+"?)\s*\([\s\S]*?\)[\s\S]*?as\s+(\$[\w]*\$)/gi;

/** parseVerifyJwt values from a Supabase config.toml */
const VERIFY_JWT_RE = /\[functions\.([^\]]+)\][^\[]*?verify_jwt\s*=\s*(true|false)/gi;

function extractRpcFunctions(files: readonly SourceFile[]): RpcFunctionIntel[] {
  const byQualified = new Map<string, RpcFunctionIntel>();
  const migrations = files
    .filter((f) => /supabase\/migrations\/.*\.sql$/i.test(f.path))
    .sort((a, b) => a.path.localeCompare(b.path)); // chronological — last-wins

  for (const f of migrations) {
    const text = f.content;
    FN_HEADER_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FN_HEADER_RE.exec(text)) !== null) {
      const qualifiedName = m[1]!.replace(/"/g, "");
      const tag = m[2]!; // $$ or $foo$
      const bodyStart = m.index + m[0].length;
      const bodyEnd = text.indexOf(tag, bodyStart);
      if (bodyEnd < 0) continue;
      const body = text.slice(bodyStart, bodyEnd).trim();

      // Attributes appear either before or after the body — scan the ~400
      // chars around the header + a peek past the body-close for LANGUAGE etc.
      const meta = text.slice(m.index, Math.min(text.length, bodyEnd + 400));
      const securityDefiner = /security\s+definer/i.test(meta);
      const hasSetSearchPath = /set\s+search_path/i.test(meta);
      const langMatch = meta.match(/language\s+([a-z]+)/i);
      const language = (langMatch?.[1] ?? "plpgsql").toLowerCase();

      const name = qualifiedName.split(".").pop()!;
      byQualified.set(qualifiedName, {
        name,
        qualifiedName,
        securityDefiner,
        hasSetSearchPath,
        language,
        body: body.length > 2000 ? body.slice(0, 2000) + "…" : body,
        path: f.path,
      });
    }
  }
  return [...byQualified.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ─── verify_jwt extraction (config.toml, per-function) ───────────────────────

function extractVerifyJwt(files: readonly SourceFile[]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const toml = files.find((f) => /supabase\/config\.toml$/i.test(f.path));
  if (!toml) return out;
  VERIFY_JWT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VERIFY_JWT_RE.exec(toml.content)) !== null) {
    out.set(m[1]!, m[2] === "true");
  }
  return out;
}

// ─── Render the human-readable brief (what the agent actually reads) ─────────

function renderHumanBrief(rpcs: RpcFunctionIntel[], edges: EdgeFunctionSummary[]): string {
  const parts: string[] = ["## Backend brief (pre-computed by Kelp — no need to grep for this)"];

  if (rpcs.length) {
    parts.push("\n### Postgres functions defined in migrations");
    parts.push(
      "These functions are the trusted helpers RLS policies delegate to. " +
        "SECURITY DEFINER runs as the function OWNER — bypassing the caller's " +
        "RLS — so those are your primary auth-bypass targets. A missing " +
        "`SET search_path` on a DEFINER function is a known vulnerability.",
    );
    for (const fn of rpcs) {
      const flags = [
        fn.securityDefiner ? "SECURITY DEFINER" : "SECURITY INVOKER",
        fn.hasSetSearchPath ? "search_path set ✓" : "no SET search_path ⚠",
        fn.language,
      ].join(" · ");
      parts.push(`\n**${fn.qualifiedName}()** — ${flags}  (${fn.path})\n\`\`\`\n${fn.body}\n\`\`\``);
    }
  } else {
    parts.push("\n### Postgres functions: none found in migrations.");
  }

  if (edges.length) {
    parts.push("\n### Edge functions summary");
    parts.push(
      "verify_jwt=false means the Supabase gateway does NOT check the JWT — " +
        "the function must validate identity itself; a missing manual check " +
        "there is a critical authorization bypass. Kelp will REFUSE to invoke " +
        "any function marked mutating below (delete/create/payment/…): reason " +
        "about them from source only.",
    );
    for (const e of edges) {
      const flags = [
        e.mutating ? `mutating (${e.mutationReason ?? "reason unknown"}) — blocked` : "read-only",
        `verify_jwt=${e.verifyJwt === null ? "?" : e.verifyJwt}`,
      ].join(" · ");
      const params = [
        e.bodyParams.length ? `body: [${e.bodyParams.join(", ")}]` : "",
        e.queryParams.length ? `query: [${e.queryParams.join(", ")}]` : "",
        e.identityParams.length ? `identity-like: [${e.identityParams.join(", ")}]` : "",
        e.urlParams.length ? `url-like: [${e.urlParams.join(", ")}]` : "",
      ].filter(Boolean).join(" · ");
      parts.push(`- **${e.name}** — ${flags}${params ? ` — ${params}` : ""}`);
    }
  }

  parts.push(
    "\n### How to use this brief",
    "Skip `list_source_files` / `read_source_file` for anything covered above — " +
      "you already have it. Reserve those tools for files this brief REFERENCES " +
      "and you still need to read (specific edge-function bodies you want to " +
      "attack, unusual migrations). Go straight to hypothesis + `http_probe`.",
  );

  return parts.join("\n");
}

export function buildBackendBrief(
  files: readonly SourceFile[],
  edgeFunctions: readonly DiscoveredEdgeFunction[],
): BackendBrief {
  const rpcFunctions = extractRpcFunctions(files);
  const verifyJwtMap = extractVerifyJwt(files);
  const edgeFnSummaries: EdgeFunctionSummary[] = edgeFunctions.map((e) => ({
    name: e.name,
    path: e.path,
    mutating: e.mutating,
    mutationReason: e.mutationReason,
    verifyJwt: verifyJwtMap.has(e.name) ? verifyJwtMap.get(e.name)! : null,
    bodyParams: e.bodyParams,
    queryParams: e.queryParams,
    identityParams: e.identityParams,
    urlParams: e.urlParams,
  }));
  return {
    rpcFunctions,
    edgeFunctions: edgeFnSummaries,
    humanText: renderHumanBrief(rpcFunctions, edgeFnSummaries),
  };
}
