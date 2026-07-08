// Deterministic secret scanner.
//
// Pure logic, no I/O: it takes already-read files and returns findings. The repo
// reader (worker) handles fetching contents and filtering node_modules etc.
//
// Two detection layers:
//   1. Known-provider patterns (high precision).
//   2. High-entropy quoted strings that no pattern matched (lower confidence).
// A secret found in a CLIENT-SIDE file is more dangerous than in server code
// (it ships to every visitor), so its severity is bumped.
//
// We NEVER keep the secret value: findings carry a masked preview only.

import type { Severity } from "../types.js";
import { fingerprint } from "../fingerprint.js";

export interface SourceFile {
  path: string;
  content: string;
}

export interface SecretFinding {
  fingerprint: string;
  ruleId: string;
  provider: string;
  title: string;
  severity: Severity;
  path: string;
  line: number;
  /** masked, e.g. "sk_live_…", never the full value */
  preview: string;
  clientSide: boolean;
  confidence: "high" | "medium";
}

interface Rule {
  id: string;
  provider: string;
  title: string;
  regex: RegExp;
  severity: Severity;
}

// Ordered, high-precision provider rules. Each regex captures the secret in
// group 1 (or matches whole). `g` flag so we can find multiple per line.
const RULES: Rule[] = [
  {
    id: "stripe-secret-live",
    provider: "Stripe",
    title: "Stripe live secret key",
    regex: /\bsk_live_[0-9a-zA-Z]{16,}\b/g,
    severity: "critical",
  },
  {
    id: "stripe-secret-test",
    provider: "Stripe",
    title: "Stripe test secret key",
    regex: /\bsk_test_[0-9a-zA-Z]{16,}\b/g,
    severity: "high",
  },
  {
    id: "aws-access-key-id",
    provider: "AWS",
    title: "AWS access key ID",
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    severity: "high",
  },
  {
    id: "github-token",
    provider: "GitHub",
    title: "GitHub access token",
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36,}\b/g,
    severity: "high",
  },
  {
    id: "github-pat-fine",
    provider: "GitHub",
    title: "GitHub fine-grained PAT",
    regex: /\bgithub_pat_[0-9A-Za-z_]{60,}\b/g,
    severity: "high",
  },
  {
    id: "openai-key",
    provider: "OpenAI",
    title: "OpenAI API key",
    regex: /\bsk-(?:proj-)?[0-9A-Za-z_-]{20,}\b/g,
    severity: "high",
  },
  {
    id: "google-api-key",
    provider: "Google/Firebase",
    title: "Google/Firebase API key",
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    severity: "medium",
  },
  {
    id: "slack-token",
    provider: "Slack",
    title: "Slack token",
    regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g,
    severity: "high",
  },
  {
    id: "private-key-block",
    provider: "Generic",
    title: "Private key block",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
    severity: "critical",
  },
];

// JWT (Supabase keys are JWTs). We inspect the payload to tell service_role
// (must never be exposed) from anon (public by design — not flagged).
const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;

// Common placeholder / non-secret values to ignore.
const PLACEHOLDER_RE =
  /^(?:your|my|the|example|changeme|placeholder|xxx+|test|dummy|fake|<.*>|\$\{.*\}|process\.env)/i;

// Client-side heuristic. Extension .ts/.js is deliberately NOT here: it is
// ambiguous (server code is also .ts). We flag files that clearly ship to the
// browser — component files and static/client directories.
const CLIENT_PATH_RE =
  /(?:^|\/)(?:public|client|www|assets|static)\/|\.(?:jsx|tsx|vue|svelte|html)$/i;

const SKIP_PATH_RE =
  /(?:^|\/)(?:node_modules|\.git|dist|build|\.next|vendor)\/|(?:^|\/)[^/]*-lock\.(?:json|ya?ml)$|\.(?:lock|min\.js|map)$|\.env\.example$/i;

/** Should this path be scanned at all? */
export function shouldScanPath(path: string): boolean {
  return !SKIP_PATH_RE.test(path);
}

function isClientSide(path: string): boolean {
  return CLIENT_PATH_RE.test(path);
}

function mask(value: string): string {
  if (value.length <= 8) return "…";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/** Shannon entropy (bits/char) of a string. */
export function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const c of counts.values()) {
    const p = c / s.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** Decode a JWT payload's "role" claim, or null if not decodable. */
function jwtRole(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1]!, "base64url").toString("utf8");
    const payload = JSON.parse(json) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

function bump(severity: Severity, clientSide: boolean): Severity {
  if (!clientSide) return severity;
  const order: Severity[] = ["low", "medium", "high", "critical"];
  const i = order.indexOf(severity);
  return order[Math.min(i + 1, order.length - 1)]!;
}

/** Does a value already match one of the high-precision provider rules? */
function matchesKnownRule(value: string): boolean {
  return RULES.some((r) => {
    r.regex.lastIndex = 0;
    return r.regex.test(value);
  });
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

// High-entropy assignment fallback: `SOMETHING = "long-random-looking-string"`.
const ASSIGN_RE =
  /(?:key|secret|token|passwd|password|api[_-]?key|auth|credential)["'`\]]?\s*[:=]\s*["'`]([^"'`\s]{20,})["'`]/gi;
const ENTROPY_MIN = 4.0; // bits/char; random base64/hex is typically > 4

// Character-class diversity: generated credentials (base64/hex) mix at least two
// of {lowercase, uppercase, digit}. A single class means human-readable text —
// e.g. a snake_case localStorage key like `blackfit_pending_workouts`, which can
// clear the entropy bar but is NOT a secret. Requiring ≥2 classes kills those
// false positives while keeping hex (lower+digit) and base64 (lower+upper+digit).
function charClasses(s: string): number {
  return (
    Number(/[a-z]/.test(s)) + Number(/[A-Z]/.test(s)) + Number(/[0-9]/.test(s))
  );
}

// A single in-file match. `value` is the raw secret — it exists only in memory
// while scanning or building a fix, and must never be persisted or logged.
interface SecretMatch {
  finding: SecretFinding;
  value: string;
  index: number;
}

function scanFile(file: SourceFile): SecretMatch[] {
  const out: SecretMatch[] = [];
  const clientSide = isClientSide(file.path);

  // Layer 1: provider patterns.
  for (const rule of RULES) {
    rule.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.regex.exec(file.content)) !== null) {
      const value = m[0];
      out.push({
        value,
        index: m.index,
        finding: {
          fingerprint: fingerprint([rule.id, file.path, mask(value)]),
          ruleId: rule.id,
          provider: rule.provider,
          title: rule.title,
          severity: bump(rule.severity, clientSide),
          path: file.path,
          line: lineOf(file.content, m.index),
          preview: mask(value),
          clientSide,
          confidence: "high",
        },
      });
    }
  }

  // Supabase / generic JWTs: flag service_role, ignore anon (public by design).
  JWT_RE.lastIndex = 0;
  let jm: RegExpExecArray | null;
  while ((jm = JWT_RE.exec(file.content)) !== null) {
    const token = jm[0];
    const role = jwtRole(token);
    if (role === "anon") continue; // anon key is meant to be public with RLS
    const isServiceRole = role === "service_role";
    out.push({
      value: token,
      index: jm.index,
      finding: {
        fingerprint: fingerprint(["jwt", file.path, mask(token)]),
        ruleId: isServiceRole ? "supabase-service-role" : "jwt-exposed",
        provider: isServiceRole ? "Supabase" : "Generic",
        title: isServiceRole
          ? "Supabase service_role key (full DB access)"
          : "Exposed JWT",
        severity: bump(isServiceRole ? "critical" : "medium", clientSide),
        path: file.path,
        line: lineOf(file.content, jm.index),
        preview: mask(token),
        clientSide,
        confidence: isServiceRole ? "high" : "medium",
      },
    });
  }

  // Layer 2: high-entropy assignments not already matched above.
  ASSIGN_RE.lastIndex = 0;
  let am: RegExpExecArray | null;
  while ((am = ASSIGN_RE.exec(file.content)) !== null) {
    const value = am[1]!;
    if (PLACEHOLDER_RE.test(value)) continue;
    // Template-literal interpolation (`req-${id}-${Date.now()}`) is built at
    // runtime — it is NOT a hard-coded secret. This kills the common false
    // positive on idempotency keys / cache keys assigned to a *Key name.
    if (value.includes("${")) continue;
    // JWTs are owned by the JWT layer above — which deliberately SKIPS the
    // Supabase anon key (public by design). Don't second-guess it here, or we
    // re-flag public keys as suspicious. Same for known provider secrets: the
    // dedicated rule already reported them with high confidence.
    if (value.startsWith("eyJ")) continue;
    if (matchesKnownRule(value)) continue;
    if (charClasses(value) < 2) continue; // human-readable text, not a credential
    if (shannonEntropy(value) < ENTROPY_MIN) continue;
    out.push({
      value,
      index: am.index,
      finding: {
        fingerprint: fingerprint(["entropy", file.path, mask(value)]),
        ruleId: "high-entropy-string",
        provider: "Unknown",
        title: "High-entropy string assigned to a secret-like name",
        severity: bump("medium", clientSide),
        path: file.path,
        line: lineOf(file.content, am.index),
        preview: mask(value),
        clientSide,
        confidence: "medium",
      },
    });
  }

  return out;
}

/** Scan already-read files for exposed secrets. */
export function detectSecrets(files: readonly SourceFile[]): SecretFinding[] {
  const out: SecretFinding[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    if (!shouldScanPath(file.path)) continue;
    for (const m of scanFile(file)) {
      if (seen.has(m.finding.fingerprint)) continue;
      seen.add(m.finding.fingerprint);
      out.push(m.finding);
    }
  }

  return out;
}

/**
 * Re-locate a previously detected secret in a (possibly newer) copy of its
 * file, by fingerprint. Returns the raw value and byte offset so a remediation
 * can replace it, or null if the secret is no longer there (moved/fixed).
 * The returned value must never be persisted or logged.
 */
export function locateSecret(
  file: SourceFile,
  findingFingerprint: string,
): { value: string; index: number } | null {
  for (const m of scanFile(file)) {
    if (m.finding.fingerprint === findingFingerprint) {
      return { value: m.value, index: m.index };
    }
  }
  return null;
}
