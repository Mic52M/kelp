// Static analyzer for backend secrets exposed to the browser through a
// public env-var prefix.
//
// Every frontend framework has a prefix that means "inline this env var into
// the client bundle": Next.js `NEXT_PUBLIC_`, Vite `VITE_`, CRA `REACT_APP_`,
// Expo `EXPO_PUBLIC_`, Nuxt `NUXT_PUBLIC_`, SvelteKit/Astro `PUBLIC_`, Gatsby
// `GATSBY_`, Angular `NG_APP_`. Anything named with one of those prefixes is
// shipped to every visitor, in plaintext, in the JS bundle.
//
// Vibe-coded apps reliably misuse this. The single most catastrophic case is
// a Supabase `service_role` key named `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`
// (or the Vite `VITE_...SERVICE_ROLE...` equivalent that Lovable-style apps
// produce): the key bypasses Row Level Security entirely, so shipping it to
// the browser hands every visitor full read/write on the whole database.
//
// The secret scanner (secrets.ts) catches the literal key VALUE when it is in
// the repo. This scanner catches the NAMING convention even when the value
// lives only in the deploy environment (Vercel/Netlify env), because the
// public-prefixed name is itself the vulnerability: it is a declaration that
// this secret is meant to reach the client.
//
// High precision by construction: the prefix has a defined framework meaning,
// and the dangerous suffixes (SERVICE_ROLE, SECRET, PRIVATE_KEY, PASSWORD, …)
// are matched as whole segments. Keys that are public BY DESIGN (anon,
// publishable, a bare API key like Firebase's) are explicitly excluded, so
// `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
// never fire.

import type { Severity } from "../types.js";
import type { SourceFile } from "./secrets.js";
import { fingerprint } from "../fingerprint.js";

export interface ClientEnvFinding {
  fingerprint: string;
  ruleId: "client_exposed_secret";
  severity: Severity;
  confidence: "high" | "medium";
  /** Repo-relative path where the exposed var is referenced or defined. */
  path: string;
  /** 1-indexed line. */
  line: number;
  /** The offending env var name, e.g. NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY. */
  varName: string;
  title: string;
  explanation: string;
}

// Prefixes that a frontend framework inlines into the client bundle.
const PUBLIC_PREFIXES = [
  "NEXT_PUBLIC_",
  "VITE_",
  "REACT_APP_",
  "EXPO_PUBLIC_",
  "NUXT_PUBLIC_",
  "GATSBY_",
  "NG_APP_",
  "PUBLIC_", // SvelteKit / Astro
];

// Match an identifier that starts with a public prefix. Captured group 1 is
// the full identifier.
const ENV_REF_RE = new RegExp(`((?:${PUBLIC_PREFIXES.join("|")})[A-Za-z0-9_]+)`, "g");

// Public-by-design keys: never flag, even under a public prefix.
const SAFE_SEGMENT = /(?:^|_)(?:ANON|PUBLISHABLE|CLIENT_ID)(?:_|$)|PUBLIC_KEY$/;

// Catastrophic: full backend access if it reaches the browser.
const CRITICAL_SEGMENT =
  /(?:^|_)(?:SERVICE_ROLE|SERVICE_KEY|PRIVATE_KEY|SECRET_KEY|DB_PASSWORD|PASSWORD|PASSWD)(?:_|$)/;
// Sensitive but ambiguous: a trailing SECRET/PRIVATE, or an ADMIN credential.
// Trailing-only (or followed by KEY/TOKEN) so "SECRET_SANTA_ENABLED" is quiet.
const HIGH_SEGMENT =
  /(?:^|_)(?:SECRET|PRIVATE)(?:_KEY|_TOKEN)?$|(?:^|_)ADMIN_(?:SECRET|KEY|TOKEN|PASSWORD)(?:_|$)/;

function classify(varName: string): { severity: Severity; confidence: "high" | "medium" } | null {
  const U = varName.toUpperCase();
  let rest = U;
  for (const p of PUBLIC_PREFIXES) {
    if (U.startsWith(p)) {
      rest = U.slice(p.length);
      break;
    }
  }
  if (SAFE_SEGMENT.test(rest)) return null;
  if (CRITICAL_SEGMENT.test(rest)) return { severity: "critical", confidence: "high" };
  if (HIGH_SEGMENT.test(rest)) return { severity: "high", confidence: "medium" };
  return null;
}

function isScannable(path: string): boolean {
  // Code that references env, and .env files that define it. Skip examples.
  if (/\.env\.example$/i.test(path)) return false;
  return /\.[cm]?[jt]sx?$/i.test(path) || /\.(?:vue|svelte|astro)$/i.test(path) || /(?:^|\/)\.env(?:\.|$)/i.test(path);
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

/** Scan the repo for backend secrets exposed to the client via a public
 *  env-var prefix. Pure over the in-memory file set. */
export function analyzeClientEnv(files: readonly SourceFile[]): ClientEnvFinding[] {
  const findings: ClientEnvFinding[] = [];
  const seen = new Set<string>();

  for (const f of files) {
    if (!isScannable(f.path)) continue;
    const content = f.content;

    ENV_REF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ENV_REF_RE.exec(content))) {
      const varName = m[1]!;
      const verdict = classify(varName);
      if (!verdict) continue;

      // One finding per (file, var) so a var referenced many times in a file
      // is reported once, at its first occurrence.
      const key = `${f.path}::${varName}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const line = lineOf(content, m.index);
      const isServiceRole = /SERVICE_ROLE|SERVICE_KEY/.test(varName);
      findings.push({
        fingerprint: fingerprint(["client-env", varName, f.path]),
        ruleId: "client_exposed_secret",
        severity: verdict.severity,
        confidence: verdict.confidence,
        path: f.path,
        line,
        varName,
        title: `Backend secret ${varName} is exposed to the browser`,
        explanation:
          `${varName} uses a public env-var prefix, so the build tool inlines ` +
          `its value into the client bundle where every visitor can read it. ` +
          (isServiceRole
            ? `A Supabase service_role key in the browser bypasses Row Level ` +
              `Security completely: any visitor gets full read and write on the ` +
              `entire database. Move it to a server-only variable (drop the ` +
              `public prefix), use it only in server code, and rotate the key now. `
            : `A backend secret in the client bundle is readable by anyone who ` +
              `opens dev tools. Move it to a server-only variable (drop the ` +
              `public prefix) and rotate it. `) +
          `If this value really is meant to be public (an anon or publishable ` +
          `key), rename it so it does not read as a secret.`,
      });
    }
  }

  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  findings.sort(
    (a, b) => order[a.severity] - order[b.severity] || a.path.localeCompare(b.path) || a.line - b.line,
  );
  return findings;
}
