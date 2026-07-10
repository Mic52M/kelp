// AuthModelBrief — deterministic pre-recon of the app's threat model.
//
// The false-positive audit on usatopoint (5 findings, 4 refuted by the user's
// AI reviewer) surfaced a specific failure mode: the agents pattern-match on
// OWASP-generic flags ("wildcard CORS is bad", "no CSRF token = CSRF") without
// verifying that the pattern applies to THIS app's auth model. The evidence
// gate confirms observables but not exploitability — every filed observable
// was real, but only one (newsletter INSERT) actually enabled attacker harm.
//
// Fix: derive the auth model BEFORE the agents run, hand it to them as
// PRE-VERIFIED FACTS, and gate report_finding on class-specific exploitability
// preconditions that read from the model. Threat modeling first, pattern
// matching last.
//
// This module holds the pure static-derivation part (from source files). The
// dynamic parts (login response inspection) live in the worker.

import type { SourceFile } from "../scanners/secrets.js";

export interface AuthModelBrief {
  /**
   * How the app authenticates on the wire. Only the FIRST of these is treated
   * as ambient-authority-bearing:
   *  - `cookie_session`  → cookies attached automatically by the browser cross-
   *                        origin. CSRF applies here.
   *  - `bearer_jwt`      → JWT in `Authorization` header, sent explicitly by
   *                        the app's own JS. Cross-origin sites cannot force
   *                        the browser to send it. No CSRF vector.
   *  - `mixed`           → both patterns observed. Treat as cookie_session.
   *  - `none`            → all endpoints anonymous. No credentials to exfil.
   */
  primaryAuthMode: "cookie_session" | "bearer_jwt" | "mixed" | "none";

  /** True iff Kelp observed at least one `Set-Cookie` on an auth response. */
  hasCookieSessions: boolean;

  /**
   * True iff ANY source file returns `Access-Control-Allow-Credentials: true`.
   * When false, a wildcard CORS origin (`*`) does NOT leak credentials — the
   * browser blocks cookie/header sharing with the calling origin. Most CORS
   * findings collapse under this fact.
   */
  corsAllowsCredentials: boolean;

  /**
   * Origins the app explicitly whitelists in a `_shared/cors.ts`-style
   * helper. Empty when only wildcard `*` was observed.
   */
  corsWhitelistedOrigins: string[];

  /**
   * File paths where Kelp detected server-side price/amount recomputation
   * (attackers can't tamper with client-supplied totals when the server
   * looks up authoritative prices from a `products` table).
   */
  serverSidePriceRecalcHints: string[];

  /**
   * Table names that participate in one-time-token flows (unsubscribe,
   * magic link, email confirmation). Any anon-INSERT/SELECT finding on
   * these tables must consider that the token itself is the auth check.
   */
  oneTimeTokenTables: string[];

  /**
   * The paragraph agents receive verbatim as PRE-VERIFIED FACTS. Do not
   * mutate at call sites — call `buildAuthModelNarrative` to regenerate.
   */
  narrative: string;
}

// ─── Static derivation ───────────────────────────────────────────────────────

// Match ONLY real header-write patterns, not bare mentions of the string
// "Set-Cookie" (which appear in vendor lib comments / docs / node_modules-ish
// files a vibe-coded repo can ship). A false positive here would flip the
// primary auth mode to cookie_session and re-open CSRF findings on a
// bearer-JWT app, so keep this tight.
const SET_COOKIE_RE = new RegExp(
  [
    // res.cookie(...) / response.cookies.set(...) — Express / Next
    /(?:^|[^a-zA-Z0-9_])(?:res|response)\s*\.\s*(?:cookie|cookies\s*\.\s*set)\s*\(/.source,
    // headers.set/append("Set-Cookie", …) — Web fetch Response
    /headers\s*\.\s*(?:set|append)\s*\(\s*["'`]Set-Cookie["'`]/i.source,
    // Object-literal header map: "Set-Cookie": "…"
    /["'`]Set-Cookie["'`]\s*:\s*["'`]/.source,
    // Supabase SSR helper
    /createServerClient\s*\(/.source,
  ].join("|"),
  "i",
);

/**
 * Detect whether the app EVER sets a session cookie. Supabase Auth itself
 * returns JWT in the response body (bearer model) and doesn't set cookies —
 * so a positive here means the customer's own edge functions or Next.js
 * middleware are doing it, which is the actual signal we care about.
 */
export function detectCookieSessions(files: readonly SourceFile[]): boolean {
  return files.some((f) => SET_COOKIE_RE.test(f.content));
}

const CORS_ALLOW_CREDS_RE = /Access-Control-Allow-Credentials[^a-zA-Z0-9_-]+["']?true["']?/i;

/**
 * Detect whether any source file returns `Access-Control-Allow-Credentials:
 * true`. Handles both TypeScript object literals (`"Access-Control-Allow-
 * Credentials": "true"`) and header assignments (`res.headers.set("Access-
 * Control-Allow-Credentials", "true")`). Conservative — false negatives
 * (missing "true") are safer than false positives here.
 */
export function detectCorsAllowCredentials(files: readonly SourceFile[]): boolean {
  return files.some((f) => CORS_ALLOW_CREDS_RE.test(f.content));
}

/**
 * Extract origins from a `_shared/cors.ts` or similar helper. Looks for
 * `Access-Control-Allow-Origin` values that are NOT `*`.
 */
export function detectCorsWhitelistedOrigins(files: readonly SourceFile[]): string[] {
  const origins = new Set<string>();
  const re = /Access-Control-Allow-Origin['"\s:=]+["'](https?:\/\/[^"']+)["']/gi;
  for (const f of files) {
    for (const m of f.content.matchAll(re)) {
      if (m[1] && m[1] !== "*") origins.add(m[1]);
    }
  }
  return [...origins].sort();
}

const PRICE_RECALC_RE =
  /(?:from|table)[\s(]*['"`]products['"`][\s\S]{0,400}?(?:price|amount|total|unit_price)/i;

/**
 * Detect server-side price recomputation in edge functions. The pattern we
 * look for: reading `products` (authoritative prices) and applying them to
 * order lines — i.e. the server does NOT trust client-supplied totals.
 */
export function detectServerSidePriceRecalc(files: readonly SourceFile[]): string[] {
  const hits: string[] = [];
  for (const f of files) {
    if (!f.path.includes("/functions/") && !/order|checkout|payment/i.test(f.path)) continue;
    if (PRICE_RECALC_RE.test(f.content)) hits.push(f.path);
  }
  return hits;
}

const TOKEN_TABLE_RE =
  /(?:from|table)[\s(]*['"`]([a-z_]+_tokens?)['"`][\s\S]{0,600}?(?:validate|check|expires?_?at|used_?at)/i;
const TOKEN_HINT_RE = /token\s*[:=]\s*(?:crypto\.randomUUID|randomBytes|nanoid)/i;

/**
 * Detect tables that participate in one-time-token flows. Two heuristics:
 * (a) a table name containing `_token(s)` that appears near validation logic,
 * (b) explicit `token: crypto.randomUUID()` / `randomBytes()` / `nanoid()`
 * usage nearby — a strong signal that this endpoint IS the token-gated auth.
 */
export function detectOneTimeTokenTables(files: readonly SourceFile[]): string[] {
  const tables = new Set<string>();
  for (const f of files) {
    for (const m of f.content.matchAll(new RegExp(TOKEN_TABLE_RE, "gi"))) {
      if (m[1]) tables.add(m[1]);
    }
    // If we see explicit random-token generation, log the containing feature
    // by looking for a nearby table name in the same file.
    if (TOKEN_HINT_RE.test(f.content)) {
      const nearby = f.content.match(/(?:from|table)[\s(]*['"`]([a-z_]+_tokens?)['"`]/i);
      if (nearby?.[1]) tables.add(nearby[1]);
    }
  }
  return [...tables].sort();
}

/** Machine-checkable facts. `hasCookieSessions` filled by the worker. */
export function deriveStaticAuthFacts(
  files: readonly SourceFile[],
): Omit<AuthModelBrief, "primaryAuthMode" | "hasCookieSessions" | "narrative"> {
  return {
    corsAllowsCredentials: detectCorsAllowCredentials(files),
    corsWhitelistedOrigins: detectCorsWhitelistedOrigins(files),
    serverSidePriceRecalcHints: detectServerSidePriceRecalc(files),
    oneTimeTokenTables: detectOneTimeTokenTables(files),
  };
}

// ─── Narrative ──────────────────────────────────────────────────────────────

/**
 * Compose the narrative agents read at the top of their system prompt. This
 * paragraph is not decoration — it's the machine-verified ground truth the
 * agents must reason from. Keep every claim tied to a boolean in the brief so
 * the model has nothing to "creatively interpret".
 */
export function buildAuthModelNarrative(
  brief: Omit<AuthModelBrief, "narrative">,
): string {
  const lines: string[] = ["AUTH MODEL — Kelp-verified facts, treat as GIVEN:"];

  // 1. Primary auth mode
  if (brief.primaryAuthMode === "cookie_session") {
    lines.push(
      " · Auth uses SESSION COOKIES (ambient authority). CSRF is a real " +
        "threat surface on state-changing endpoints without a CSRF token.",
    );
  } else if (brief.primaryAuthMode === "bearer_jwt") {
    lines.push(
      " · Auth is BEARER JWT in the Authorization header. The client's JS " +
        "attaches it explicitly on every call. Browsers NEVER attach it " +
        "automatically cross-origin. CSRF-style attacks require ambient " +
        "authority, which THIS APP DOES NOT HAVE. Do NOT file CSRF findings " +
        "on any endpoint.",
    );
  } else if (brief.primaryAuthMode === "mixed") {
    lines.push(
      " · Auth mixes session cookies AND bearer JWT. CSRF applies to " +
        "cookie-authed endpoints; bearer-only endpoints are CSRF-immune.",
    );
  } else {
    lines.push(
      " · No authenticated endpoints observed — the app is entirely public. " +
        "Impact for any 'auth bypass' finding must be argued from data, not " +
        "identity.",
    );
  }

  // 2. CORS credentials
  if (brief.corsAllowsCredentials) {
    lines.push(
      " · At least one endpoint sets Access-Control-Allow-Credentials: true. " +
        "Wildcard/permissive CORS on THOSE endpoints IS exploitable — the " +
        "browser will share cookies/auth headers cross-origin. Investigate " +
        "which endpoint and file the finding scoped to it.",
    );
  } else {
    lines.push(
      " · NO endpoint sets Access-Control-Allow-Credentials: true. This " +
        "means wildcard CORS (`*`) does NOT leak credentials — the browser " +
        "will not share cookies/auth headers, and cross-origin JS cannot " +
        "read the response unless the server matches the origin. 'Wildcard " +
        "CORS' alone is NOT a finding at medium+ severity. File as low " +
        "hardening only if you also prove a specific sensitive value is " +
        "returned in the body.",
    );
  }

  // 3. CORS whitelist
  if (brief.corsWhitelistedOrigins.length > 0) {
    lines.push(
      ` · Kelp observed CORS whitelist entries: ${brief.corsWhitelistedOrigins
        .slice(0, 6)
        .join(", ")}${brief.corsWhitelistedOrigins.length > 6 ? ", …" : ""}`,
    );
  }

  // 4. Server-side price recalc
  if (brief.serverSidePriceRecalcHints.length > 0) {
    lines.push(
      ` · Server-side price recalculation detected in: ${brief.serverSidePriceRecalcHints
        .slice(0, 4)
        .join(", ")}. Client-supplied totals CANNOT be tampered with in ` +
        "these flows — do not file 'body userId / body price override' " +
        "findings there unless the server actually trusts the input.",
    );
  }

  // 5. One-time-token flows
  if (brief.oneTimeTokenTables.length > 0) {
    lines.push(
      ` · One-time-token tables detected: ${brief.oneTimeTokenTables.join(
        ", ",
      )}. Anonymous access to endpoints that consume these tokens is the ` +
        "designed auth model — the TOKEN is the credential. Do not file " +
        "'no auth check' findings on these flows unless the token check " +
        "itself is broken.",
    );
  }

  // 6. Universal impact-chain requirement
  lines.push(
    "",
    "BEFORE FILING ANY FINDING you must state the impact chain: (1) the " +
      "attacker's starting capability, (2) the victim, (3) the exact " +
      "primitive that chains — grounded in the facts above — (4) what the " +
      "attacker gains beyond acting alone. If any step is hand-waved, " +
      "the finding is a false positive. Prefer 'no finding' to a weak one.",
  );

  return lines.join("\n");
}

/**
 * One-shot: derive the full brief from source files. Worker call site is a
 * single line. When there are no source files (rare; DB-only projects), the
 * brief falls back to `bearer_jwt` — the safe default for Supabase-based apps.
 */
export function buildAuthModelBrief(files: readonly SourceFile[]): AuthModelBrief {
  const staticFacts = deriveStaticAuthFacts(files);
  const hasCookieSessions = detectCookieSessions(files);
  const primaryAuthMode: AuthModelBrief["primaryAuthMode"] = hasCookieSessions
    ? staticFacts.corsAllowsCredentials
      ? "mixed"
      : "cookie_session"
    : "bearer_jwt";
  const partial: Omit<AuthModelBrief, "narrative"> = {
    primaryAuthMode,
    hasCookieSessions,
    ...staticFacts,
  };
  return { ...partial, narrative: buildAuthModelNarrative(partial) };
}

// ─── Exploitability gate ─────────────────────────────────────────────────────

/**
 * Called AFTER the per-probe evidence gate passes. Refuses report_finding
 * when the declared vulnClass + severity don't survive the auth model.
 *
 * The rules here are conservative on purpose — they only reject when the
 * facts CLEARLY contradict the finding shape. When in doubt the finding
 * passes and the triage LLM has the last word.
 *
 * Returns null on pass, a specific reason string on rejection.
 */
export function checkExploitability(
  finding: {
    vulnClass: string;
    severity: string;
    title: string;
    evidence: string;
  },
  authModel: AuthModelBrief,
): string | null {
  const t = finding.title.toLowerCase();
  const e = finding.evidence.toLowerCase();
  const surface = `${t} ${e}`;
  const isMediumPlus =
    finding.severity === "medium" ||
    finding.severity === "high" ||
    finding.severity === "critical";

  // ── Rule 1: CSRF-style findings require ambient authority ─────────────────
  if (/\bcsrf\b|cross-?site request forgery/.test(surface)) {
    if (!authModel.hasCookieSessions && !authModel.corsAllowsCredentials) {
      return (
        "CSRF is not applicable to this app. Auth is bearer JWT in the " +
        "Authorization header (no ambient authority) and no endpoint sets " +
        "Access-Control-Allow-Credentials: true. A cross-origin attacker " +
        "cannot force the victim's browser to send their JWT — the browser " +
        "never attaches Bearer tokens automatically. Do not file CSRF here."
      );
    }
  }

  // ── Rule 2: CORS-permissive findings at medium+ require credentials OR a
  //           named sensitive body ──────────────────────────────────────────
  if (
    isMediumPlus &&
    /\bcors\b|wildcard.*origin|permissive.*origin|allow-origin/.test(surface) &&
    !authModel.corsAllowsCredentials
  ) {
    // Allow if the evidence names a specific sensitive value in the response.
    const namesSensitive =
      /password|token|secret|api[_-]?key|service_role|jwt|bearer|session[_-]?id|private[_-]?key/.test(
        e,
      );
    if (!namesSensitive) {
      return (
        "Wildcard/permissive CORS at medium+ severity requires either " +
        "(a) Access-Control-Allow-Credentials: true on the endpoint (this " +
        "app has none), or (b) the response body naming a specific " +
        "sensitive value (token, secret, PII). Without one of those, the " +
        "browser blocks cross-origin credential/response sharing and " +
        "there's no exploit. File as `severity=low` (hardening only) if " +
        "you still want it recorded, else don't file."
      );
    }
  }

  // ── Rule 3: Anonymous INSERT findings require downstream harm ─────────────
  if (
    finding.vulnClass === "rls" &&
    /anon.*insert|public.*insert|anonymous.*(?:insert|subscrib|sign[_-]?up)/.test(surface)
  ) {
    const namesHarm =
      /spam|enumerat|dispatch|send[s]?.*email|publicly.*read|webhook|trigger|arbitrary\s+(?:email|address)/.test(
        e,
      );
    if (!namesHarm) {
      return (
        "Anonymous INSERT on its own is not a finding — many apps " +
        "legitimately allow anon INSERT for public forms (newsletter, " +
        "contact). Prove downstream harm in the evidence: (a) the row " +
        "becomes publicly readable, (b) the INSERT dispatches an email/" +
        "webhook that can be weaponized against a victim, or (c) the row " +
        "enables enumeration of other records. Without that, don't file."
      );
    }
  }

  return null;
}
