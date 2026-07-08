// Repo-based Supabase recon — connect ANY Supabase/Lovable project from its
// source alone, no database credentials required.
//
// This is the unlock for Lovable Cloud (and any managed-Supabase setup): the
// customer has no Supabase dashboard, no service_role, no direct DB URL — but
// their repo commits everything Kelp needs to recon the backend:
//
//   · .env / integrations/supabase/client.ts → project URL + anon (public) key
//   · src/integrations/supabase/types.ts      → tables + columns (generated)
//   · supabase/migrations/*.sql               → RLS: enabled flag + policies
//
// All deterministic parsing (regex, no network) so it's unit-testable in core
// and reusable by any backend adapter. The output `TableIntel[]` matches the
// shape the live catalog reader produces, so the pentest toolbox treats a
// repo-derived schema and a DB-derived one identically.

import type { SourceFile } from "../scanners/secrets.js";
import type { TableIntel, TablePolicyIntel } from "./autonomous.js";

export interface SupabaseRepoConfig {
  /** e.g. https://abcd1234.supabase.co */
  url: string;
  /** project ref (the subdomain / VITE_SUPABASE_PROJECT_ID) */
  ref: string;
  /** the public anon / publishable key (never a service_role — see below) */
  anonKey: string | null;
}

const URL_RE = /https:\/\/([a-z0-9]{16,})\.supabase\.co/i;
// Public keys only: legacy anon JWTs (eyJ… with an "anon" role) or the new
// sb_publishable_… format. We deliberately never scrape a service_role here.
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{3,}/;
const PUBLISHABLE_RE = /\bsb_publishable_[A-Za-z0-9]{10,}\b/;

/** Files that legitimately hold PUBLIC Supabase config (env + generated client). */
const PUBLIC_CONFIG_PATH = /(?:^|\/)(?:\.env(?:\.[\w.]+)?|.*supabase\/client\.[cm]?tsx?)$/i;

function jwtIsAnon(jwt: string): boolean {
  const parts = jwt.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as { role?: unknown };
    // Only accept anon; a service_role JWT is a secret and must never be used here.
    return payload.role === "anon" || payload.role === undefined;
  } catch {
    return false;
  }
}

/**
 * Detect a Supabase backend + its public config from the repo. Returns null
 * when no Supabase URL is found (the app isn't Supabase-backed, or we can't
 * see its config).
 */
export function detectSupabaseConfig(files: readonly SourceFile[]): SupabaseRepoConfig | null {
  let url: string | null = null;
  let anonKey: string | null = null;

  // Prefer env + generated client for BOTH url and key; fall back to any file
  // for the URL only (it's public and unambiguous).
  for (const f of files) {
    if (!url) {
      const m = f.content.match(URL_RE);
      if (m) url = m[0];
    }
    if (!anonKey && PUBLIC_CONFIG_PATH.test(f.path)) {
      const pub = f.content.match(PUBLISHABLE_RE);
      if (pub) anonKey = pub[0];
      else {
        const jwt = f.content.match(JWT_RE);
        if (jwt && jwtIsAnon(jwt[0])) anonKey = jwt[0];
      }
    }
    if (url && anonKey) break;
  }

  if (!url) return null;
  const ref = url.match(URL_RE)?.[1] ?? "";
  return { url, ref, anonKey };
}

// ─── schema + RLS from repo ──────────────────────────────────────────────────

/** Extract table → column names from the generated `types.ts`. */
function parseTypesTs(content: string): Map<string, { name: string; type: string }[]> {
  const out = new Map<string, { name: string; type: string }[]>();
  // Narrow to the `Tables: { … }` region under `public:`.
  const tablesIdx = content.indexOf("Tables:");
  if (tablesIdx < 0) return out;
  const region = content.slice(tablesIdx);
  // Each table: `      <name>: {` then a `Row: { … }` block with `col: type`.
  const tableRe = /\n {4,}([a-z0-9_]+): \{\s*\n\s*Row: \{([\s\S]*?)\n\s*\}/gi;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(region)) !== null) {
    const table = m[1]!;
    const body = m[2]!;
    const cols: { name: string; type: string }[] = [];
    const colRe = /\n\s*([a-z0-9_]+)(\??): ([^\n]+)/gi;
    let c: RegExpExecArray | null;
    while ((c = colRe.exec(body)) !== null) {
      const type = c[3]!.replace(/[;,]\s*$/, "").trim();
      cols.push({ name: c[1]!, type });
    }
    if (cols.length) out.set(table, cols);
  }
  return out;
}

interface RlsState {
  enabled: Set<string>;
  policies: Map<string, TablePolicyIntel[]>;
}

/** Fold every migration's RLS statements into the net policy state. */
function parseMigrations(sqls: string[]): RlsState {
  const enabled = new Set<string>();
  const policies = new Map<string, TablePolicyIntel[]>();
  const key = (t: string, n: string) => `${t}::${n}`;
  const index = new Map<string, TablePolicyIntel>();

  const norm = (t: string) => t.replace(/^public\./i, "").replace(/["`]/g, "").trim();

  for (const sql of sqls) {
    // ENABLE / DISABLE row level security
    for (const m of sql.matchAll(/alter\s+table\s+(?:only\s+)?([\w.]+)\s+enable\s+row\s+level\s+security/gi)) {
      enabled.add(norm(m[1]!));
    }
    for (const m of sql.matchAll(/alter\s+table\s+(?:only\s+)?([\w.]+)\s+disable\s+row\s+level\s+security/gi)) {
      enabled.delete(norm(m[1]!));
    }
    // DROP POLICY "name" ON table
    for (const m of sql.matchAll(/drop\s+policy\s+(?:if\s+exists\s+)?["`]?([^"`\n]+?)["`]?\s+on\s+([\w.]+)/gi)) {
      const t = norm(m[2]!);
      const list = policies.get(t);
      if (list) {
        const filtered = list.filter((p) => p.name !== m[1]!.trim());
        policies.set(t, filtered);
        index.delete(key(t, m[1]!.trim()));
      }
    }
    // CREATE POLICY "name" ON table [FOR cmd] [TO roles] [USING (...)] [WITH CHECK (...)]
    for (const m of sql.matchAll(
      /create\s+policy\s+["`]?([^"`\n]+?)["`]?\s+on\s+([\w.]+)([\s\S]*?);/gi,
    )) {
      const name = m[1]!.trim();
      const table = norm(m[2]!);
      const rest = m[3]!;
      const cmd = (rest.match(/\bfor\s+(all|select|insert|update|delete)/i)?.[1] ?? "ALL").toUpperCase();
      const roles = (rest.match(/\bto\s+([\w",\s]+?)(?:\s+using|\s+with\s+check|$)/i)?.[1] ?? "")
        .split(",").map((r) => r.replace(/["`]/g, "").trim()).filter(Boolean);
      const using = balanced(rest, /\busing\s*\(/i);
      const withCheck = balanced(rest, /\bwith\s+check\s*\(/i);
      const pol: TablePolicyIntel = {
        name, command: cmd, roles: roles.length ? roles : ["public"], using, withCheck,
      };
      const k = key(table, name);
      const existing = index.get(k);
      const list = policies.get(table) ?? [];
      if (existing) Object.assign(existing, pol);
      else { list.push(pol); index.set(k, pol); }
      policies.set(table, list);
    }
  }
  return { enabled, policies };
}

/** Extract the balanced-paren expression following a keyword like USING(. */
function balanced(s: string, kw: RegExp): string | null {
  const m = kw.exec(s);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  for (; i < s.length && depth > 0; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
  }
  return s.slice(start, i - 1).trim();
}

/**
 * Build the full schema + RLS intel from the repo — the no-DB recon path.
 * Columns come from types.ts; RLS enabled-flag + policies come from the
 * migrations. Tables seen only in migrations (CREATE TABLE) are included even
 * if types.ts missed them.
 */
export function parseRepoSchema(files: readonly SourceFile[]): TableIntel[] {
  const typesFile = files.find((f) => /integrations\/supabase\/types\.[cm]?ts$/i.test(f.path));
  const cols = typesFile ? parseTypesTs(typesFile.content) : new Map<string, { name: string; type: string }[]>();

  const migrations = files
    .filter((f) => /supabase\/migrations\/.*\.sql$/i.test(f.path))
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((f) => f.content);
  const { enabled, policies } = parseMigrations(migrations);

  // Also pick up CREATE TABLE names from migrations for tables missing in types.ts.
  const tableNames = new Set<string>(cols.keys());
  for (const sql of migrations) {
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?["`]?([\w]+)["`]?/gi)) {
      tableNames.add(m[1]!);
    }
  }
  for (const t of policies.keys()) tableNames.add(t);

  return [...tableNames].sort().map((name) => ({
    name,
    columns: cols.get(name) ?? [],
    rlsEnabled: enabled.has(name),
    policies: policies.get(name) ?? [],
  }));
}
