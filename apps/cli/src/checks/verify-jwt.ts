// Static scanner for supabase/config.toml — flags edge functions with
// verify_jwt = false. That directive tells Supabase's function gateway to
// skip the JWT check, which means anyone can invoke the function without
// authenticating. Real-world source of unauthenticated data access in
// vibe-coded apps.
//
// Repo-only, no network — the config file is enough evidence.

import type { SourceFile } from "@kelp/core";

const VERIFY_JWT_RE = /\[functions\.([^\]]+)\][^\[]*?verify_jwt\s*=\s*(true|false)/gi;

export interface VerifyJwtFinding {
  fingerprint: string;
  ruleId: "supabase-config-verify-jwt-false";
  title: string;
  severity: "high";
  path: string;
  line: number;
  functionName: string;
}

/** Fingerprint that matches the hosted app's convention (see packages/core
 *  fingerprint.ts). Kept simple + stable per (path, functionName). */
function fp(path: string, fn: string): string {
  // Simple stable hash — matches the shape of core's fingerprint output
  // enough for dedup. Not cryptographic.
  let h = 5381;
  const s = `verify_jwt:${path}:${fn}`;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function lineOf(content: string, needle: string): number {
  const idx = content.indexOf(needle);
  if (idx < 0) return 1;
  return content.slice(0, idx).split("\n").length;
}

export function detectVerifyJwt(files: readonly SourceFile[]): VerifyJwtFinding[] {
  const out: VerifyJwtFinding[] = [];
  for (const f of files) {
    if (!/supabase\/config\.toml$/i.test(f.path)) continue;
    const seen = new Set<string>();
    VERIFY_JWT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = VERIFY_JWT_RE.exec(f.content)) !== null) {
      const fn = m[1]!;
      const value = m[2]!.toLowerCase();
      if (value !== "false") continue;
      if (seen.has(fn)) continue;
      seen.add(fn);
      out.push({
        fingerprint: fp(f.path, fn),
        ruleId: "supabase-config-verify-jwt-false",
        title: `Edge function "${fn}" skips JWT check (verify_jwt=false)`,
        severity: "high",
        path: f.path,
        line: lineOf(f.content, `[functions.${fn}]`),
        functionName: fn,
      });
    }
  }
  return out;
}
