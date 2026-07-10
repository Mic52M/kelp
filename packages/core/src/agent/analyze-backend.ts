// Backend analyzer — a hybrid deterministic + LLM pass that reads a
// connected repo and produces a rich `BackendReport` describing what the app
// runs on, what public config Kelp can already see, and how the auth flow
// works. Configuration reads this brief and adapts what it asks the user
// for — Supabase/Lovable Cloud apps get their credentials pre-filled from
// the repo; Firebase/Convex apps see an honest "not scannable yet" state
// instead of being forced through a Supabase-shaped form they can't fill.
//
// Architecture, layered:
//
//  Layer 1 — DETERMINISTIC EXTRACTION (this file, `extractRawSignals`).
//  Grep the repo for facts that don't require interpretation: URLs matching
//  known-provider domains, public keys with distinctive prefixes, config
//  files, package.json dependencies. Cheap, precise, and — crucially —
//  the ONLY source of ground truth for URLs and keys.
//
//  Layer 2 — LLM INTERPRETATION (`interpretSignals`). One Haiku call gets
//  the RawSignals + a curated slice of the source and returns a structured
//  `BackendReport` composing the interpretation: which backend is primary,
//  auth providers, signup path, warnings. The LLM MUST NOT invent URLs or
//  keys — it can only cite ones that appeared in RawSignals.
//
//  Layer 3 — ANTI-FABRICATION GATE (`validateReport`). After the LLM
//  responds, we check every URL and key it emitted against RawSignals. Any
//  value not present in the RawSignals is stripped from `publicConfig` and
//  a warning is recorded — same discipline as the pentest evidence gate.
//
// If the LLM call fails or Kelp is called without an LLM driver, we return
// the deterministic-only fallback: a brief with confidence 'low' and only
// facts we can prove from grep. Never throws.

import type { LlmAgentDriver } from "./loop.js";
import type { SourceFile } from "../scanners/secrets.js";

// ─── Public types ───────────────────────────────────────────────────────────

export type BackendType =
  | "supabase"
  | "firebase"
  | "convex"
  | "custom-api"
  | "unknown";

export interface DetectedUrl {
  /** the full URL as it appears in source */
  value: string;
  /** repo-relative path of the file it was found in */
  path: string;
  kind: "supabase" | "firebase" | "convex" | "other";
}

export interface DetectedKey {
  /** the raw key value — always a public one (sb_publishable_, Firebase
   *  apiKey, or JWT with role=anon). Kelp never surfaces secrets here. */
  value: string;
  path: string;
  kind:
    | "supabase_publishable"
    | "supabase_anon_jwt"
    | "firebase_api_key"
    | "convex_deploy"
    | "other";
}

export interface RawSignals {
  urls: DetectedUrl[];
  keys: DetectedKey[];
  /** repo-relative paths of well-known config files that were present */
  configFiles: string[];
  /** provider-related deps observed in package.json */
  dependencies: string[];
  /** env var NAMES referenced in source (`process.env.SUPABASE_URL`, etc.) */
  envKeyNames: string[];
  /** file paths that look like a signup/register handler (heuristic) */
  signupHints: string[];
}

export interface BackendReport {
  version: 1;
  primary: {
    type: BackendType;
    confidence: "high" | "medium" | "low";
    /** one sentence — either the LLM's summary or a deterministic fallback */
    reason: string;
  };
  /** present when the repo shows a migration in-progress (e.g. Firebase → Supabase) */
  secondary?: { type: BackendType; reason: string };
  /**
   * Kelp guarantees every value here appeared verbatim in RawSignals. The
   * anti-fabrication gate strips anything the LLM invented.
   */
  publicConfig: {
    supabaseUrl?: string;
    supabaseRef?: string;
    supabaseAnonKey?: string;
    firebaseProjectId?: string;
    firebaseApiKey?: string;
    convexUrl?: string;
    customApiBaseUrl?: string;
  };
  authFlow: {
    /** e.g. "email", "google", "magic_link", "github", "phone" */
    providers: string[];
    /** deep link (or route) to the signup form, when Kelp could locate it */
    signupPath: string | null;
    /** one paragraph, human-readable, safe to show to a non-technical user */
    narrative: string;
  };
  /** short actionable notes for the user (e.g. ".env has your URL — Kelp used it") */
  hints: string[];
  /** things that seem off ("we found both Firebase and Supabase — is this a migration?") */
  warnings: string[];
  /** ISO timestamp of when the brief was produced */
  analyzedAt: string;
}

// ─── Layer 1 — deterministic extraction ─────────────────────────────────────

const SUPABASE_URL_RE = /https:\/\/([a-z0-9]{16,})\.supabase\.co/gi;
const FIREBASE_URL_RE = /https:\/\/([a-z0-9-]+)\.firebase(?:io\.com|app)/gi;
const CONVEX_URL_RE = /https:\/\/[a-z0-9-]+\.convex\.(?:cloud|dev)/gi;
const SUPABASE_PUBLISHABLE_RE = /sb_publishable_[A-Za-z0-9]{20,}/g;
const SUPABASE_JWT_RE = /eyJ[A-Za-z0-9._-]{40,}/g;
const FIREBASE_API_KEY_RE = /AIza[A-Za-z0-9_-]{35}/g;

const PROVIDER_DEPS: Record<string, BackendType> = {
  "@supabase/supabase-js": "supabase",
  "@supabase/ssr": "supabase",
  "@supabase/auth-helpers-nextjs": "supabase",
  firebase: "firebase",
  "firebase-admin": "firebase",
  "@firebase/app": "firebase",
  convex: "convex",
  "@convex-dev/auth": "convex",
};

const CONFIG_FILE_HINTS = [
  "supabase/config.toml",
  "firebase.json",
  ".firebaserc",
  "convex.json",
  "convex/schema.ts",
  "convex/_generated",
];

const SIGNUP_PATH_RE =
  /(?:app|pages|src)\/(?:auth\/|)(?:signup|register|sign-up|create-account)(?:\/|\.)/i;

/** True when a JWT payload has `"role":"anon"`. Base64-URL decodes safely. */
function jwtIsAnon(jwt: string): boolean {
  const parts = jwt.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const pad = payload.length % 4 === 0 ? "" : "=".repeat(4 - (payload.length % 4));
    const decoded =
      typeof Buffer !== "undefined"
        ? Buffer.from(payload + pad, "base64").toString("utf8")
        : atob(payload + pad);
    return /"role"\s*:\s*"anon"/.test(decoded);
  } catch {
    return false;
  }
}

/**
 * Extract every provider signal we can prove from the repo. All fields are
 * lists of concrete matches — no interpretation happens here. Duplicates
 * are collapsed by (value, kind).
 */
export function extractRawSignals(files: readonly SourceFile[]): RawSignals {
  const urls = new Map<string, DetectedUrl>();
  const keys = new Map<string, DetectedKey>();
  const configFiles = new Set<string>();
  const dependencies = new Set<string>();
  const envKeyNames = new Set<string>();
  const signupHints = new Set<string>();

  for (const f of files) {
    // config files (path-only match)
    for (const hint of CONFIG_FILE_HINTS) {
      if (f.path === hint || f.path.endsWith("/" + hint) || f.path.includes("/" + hint)) {
        configFiles.add(hint);
      }
    }

    // signup path hints
    if (SIGNUP_PATH_RE.test(f.path)) signupHints.add(f.path);

    // package.json deps
    if (/(?:^|\/)package\.json$/.test(f.path)) {
      try {
        const j = JSON.parse(f.content) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        for (const k of Object.keys({ ...(j.dependencies ?? {}), ...(j.devDependencies ?? {}) })) {
          if (k in PROVIDER_DEPS) dependencies.add(k);
        }
      } catch {
        // malformed package.json — skip silently
      }
    }

    // env key names referenced in source
    for (const m of f.content.matchAll(
      /\b(?:process\.env|import\.meta\.env|Deno\.env\.get\(\s*["'`])[.]?([A-Z][A-Z0-9_]{4,})\b/g,
    )) {
      const name = m[1]!;
      if (
        /SUPABASE|FIREBASE|CONVEX|POSTGRES|DATABASE_URL|API_KEY|ANON_KEY|PROJECT_ID/i.test(name)
      ) {
        envKeyNames.add(name);
      }
    }
    // env key names declared in a .env-style file (KEY=value at line start)
    if (/(?:^|\/)\.env(?:\.[a-z]+)?$/i.test(f.path)) {
      for (const m of f.content.matchAll(/(?:^|\n)\s*([A-Z][A-Z0-9_]{4,})\s*=/g)) {
        const name = m[1]!;
        if (
          /SUPABASE|FIREBASE|CONVEX|POSTGRES|DATABASE_URL|API_KEY|ANON_KEY|PROJECT_ID/i.test(name)
        ) {
          envKeyNames.add(name);
        }
      }
    }

    // URLs
    for (const m of f.content.matchAll(SUPABASE_URL_RE)) {
      const key = `supabase:${m[0]}`;
      if (!urls.has(key)) urls.set(key, { value: m[0], path: f.path, kind: "supabase" });
    }
    for (const m of f.content.matchAll(FIREBASE_URL_RE)) {
      const key = `firebase:${m[0]}`;
      if (!urls.has(key)) urls.set(key, { value: m[0], path: f.path, kind: "firebase" });
    }
    for (const m of f.content.matchAll(CONVEX_URL_RE)) {
      const key = `convex:${m[0]}`;
      if (!urls.has(key)) urls.set(key, { value: m[0], path: f.path, kind: "convex" });
    }

    // keys
    for (const m of f.content.matchAll(SUPABASE_PUBLISHABLE_RE)) {
      const kkey = `pub:${m[0]}`;
      if (!keys.has(kkey))
        keys.set(kkey, { value: m[0], path: f.path, kind: "supabase_publishable" });
    }
    for (const m of f.content.matchAll(SUPABASE_JWT_RE)) {
      if (jwtIsAnon(m[0])) {
        const kkey = `jwt:${m[0].slice(0, 20)}`;
        if (!keys.has(kkey))
          keys.set(kkey, { value: m[0], path: f.path, kind: "supabase_anon_jwt" });
      }
    }
    // Firebase apiKey — only accept when it's in a Firebase config context
    // (not e.g. a Google Maps API key embedded elsewhere).
    if (/firebase|initializeApp|firebaseConfig/i.test(f.content)) {
      for (const m of f.content.matchAll(FIREBASE_API_KEY_RE)) {
        const kkey = `fbkey:${m[0]}`;
        if (!keys.has(kkey))
          keys.set(kkey, { value: m[0], path: f.path, kind: "firebase_api_key" });
      }
    }
  }

  return {
    urls: [...urls.values()],
    keys: [...keys.values()],
    configFiles: [...configFiles].sort(),
    dependencies: [...dependencies].sort(),
    envKeyNames: [...envKeyNames].sort(),
    signupHints: [...signupHints].sort(),
  };
}

/**
 * Deterministic-only best-guess when the LLM isn't available. Uses only
 * the RawSignals to fill a brief with `confidence: "low"`. Every field is
 * a fact from the signals; nothing is invented.
 */
export function fallbackReport(signals: RawSignals): BackendReport {
  const deps = signals.dependencies;
  const configs = signals.configFiles;

  let primary: BackendType = "unknown";
  let reason = "Kelp couldn't identify the backend automatically from your repo.";

  if (
    deps.some((d) => d.startsWith("@supabase/")) ||
    configs.includes("supabase/config.toml") ||
    signals.urls.some((u) => u.kind === "supabase")
  ) {
    primary = "supabase";
    reason = "Detected the Supabase client in your repo.";
  } else if (
    deps.includes("firebase") ||
    deps.includes("firebase-admin") ||
    configs.some((c) => c.startsWith("firebase")) ||
    signals.urls.some((u) => u.kind === "firebase")
  ) {
    primary = "firebase";
    reason = "Detected Firebase in your repo.";
  } else if (
    deps.includes("convex") ||
    configs.some((c) => c.startsWith("convex")) ||
    signals.urls.some((u) => u.kind === "convex")
  ) {
    primary = "convex";
    reason = "Detected Convex in your repo.";
  }

  const publicConfig: BackendReport["publicConfig"] = {};
  const supabaseUrl = signals.urls.find((u) => u.kind === "supabase");
  if (supabaseUrl) {
    publicConfig.supabaseUrl = supabaseUrl.value;
    const ref = supabaseUrl.value.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
    if (ref) publicConfig.supabaseRef = ref;
  }
  const supabaseKey = signals.keys.find(
    (k) => k.kind === "supabase_publishable" || k.kind === "supabase_anon_jwt",
  );
  if (supabaseKey) publicConfig.supabaseAnonKey = supabaseKey.value;

  const firebaseUrl = signals.urls.find((u) => u.kind === "firebase");
  if (firebaseUrl) {
    const projectId = firebaseUrl.value.match(/https:\/\/([a-z0-9-]+)\.firebase/)?.[1];
    if (projectId) publicConfig.firebaseProjectId = projectId;
  }
  const fbKey = signals.keys.find((k) => k.kind === "firebase_api_key");
  if (fbKey) publicConfig.firebaseApiKey = fbKey.value;

  const convexUrl = signals.urls.find((u) => u.kind === "convex");
  if (convexUrl) publicConfig.convexUrl = convexUrl.value;

  return {
    version: 1,
    primary: { type: primary, confidence: "low", reason },
    publicConfig,
    authFlow: {
      providers: [],
      signupPath: signals.signupHints[0] ?? null,
      narrative:
        "Kelp couldn't map the full auth flow without a deeper look. This is the deterministic-only summary.",
    },
    hints: [],
    warnings: [],
    analyzedAt: new Date().toISOString(),
  };
}

// ─── Layer 2 — LLM interpretation ───────────────────────────────────────────

const ANALYZER_SYSTEM =
  "You are Kelp's backend analyzer. You read a customer's connected repo and " +
  "produce a compact BackendReport describing what the app runs on. Your job " +
  "is INTERPRETATION on top of pre-verified facts — you compose the brief, " +
  "you do NOT invent facts.\n\n" +
  "GROUND TRUTH — do not question these:\n" +
  " · Every URL Kelp already extracted is listed in the input under `urls`. " +
  "You may cite these. You MUST NOT invent new URLs. Every URL in your " +
  "output must appear byte-identical in the input `urls`.\n" +
  " · Every public key Kelp extracted is under `keys`. Same rule: cite, " +
  "never invent.\n" +
  " · Dependencies, config files, and env-var names are ground truth too.\n\n" +
  "YOUR JOB:\n" +
  " · Decide `primary.type` — which backend the app is currently using. Set " +
  "`confidence` conservatively (high only when multiple signals converge).\n" +
  " · If the repo shows a migration in progress (two backends both live), " +
  "record the abandoned one under `secondary`.\n" +
  " · Populate `publicConfig` with values from the input. Leave a field " +
  "OUT (do not include it) if you don't have the value from the input.\n" +
  " · Describe `authFlow.narrative` in one paragraph, non-technical, warm.\n" +
  " · `authFlow.providers` from what you see in the source: 'email', " +
  "'google', 'github', 'magic_link', 'phone', 'apple', etc.\n" +
  " · `hints`: 1–3 short lines helpful to the user (e.g. 'Your .env has " +
  "SUPABASE_URL — Kelp used it').\n" +
  " · `warnings`: only when something seems off (mixed backends, missing " +
  "expected keys).\n\n" +
  "Return by calling `report_brief` ONCE with the structured output. Do not " +
  "narrate before or after — just call the tool.";

const REPORT_TOOL = {
  name: "report_brief",
  description: "Return the composed BackendReport. Call exactly once.",
  inputSchema: {
    type: "object",
    properties: {
      primary: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["supabase", "firebase", "convex", "custom-api", "unknown"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          reason: { type: "string" },
        },
        required: ["type", "confidence", "reason"],
        additionalProperties: false,
      },
      secondary: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["supabase", "firebase", "convex", "custom-api", "unknown"] },
          reason: { type: "string" },
        },
        required: ["type", "reason"],
        additionalProperties: false,
      },
      publicConfig: {
        type: "object",
        properties: {
          supabaseUrl: { type: "string" },
          supabaseRef: { type: "string" },
          supabaseAnonKey: { type: "string" },
          firebaseProjectId: { type: "string" },
          firebaseApiKey: { type: "string" },
          convexUrl: { type: "string" },
          customApiBaseUrl: { type: "string" },
        },
        additionalProperties: false,
      },
      authFlow: {
        type: "object",
        properties: {
          providers: { type: "array", items: { type: "string" } },
          signupPath: { type: ["string", "null"] },
          narrative: { type: "string" },
        },
        required: ["providers", "signupPath", "narrative"],
        additionalProperties: false,
      },
      hints: { type: "array", items: { type: "string" } },
      warnings: { type: "array", items: { type: "string" } },
    },
    required: ["primary", "publicConfig", "authFlow", "hints", "warnings"],
    additionalProperties: false,
  },
} as const;

/** How many curated files we hand to the analyzer. Kept small — the point of
 *  the deterministic layer is that we don't need to send the whole repo. */
const MAX_CURATED_FILES = 12;
const MAX_FILE_CHARS = 3500;

/**
 * Pick the ~12 files that matter most for auth-model + backend interpretation.
 * Priority: config files → package.json → src/lib/db-client → auth/signup
 * handlers → app entry.
 */
export function curateFilesForAnalyzer(
  files: readonly SourceFile[],
  signals: RawSignals,
): SourceFile[] {
  const seen = new Set<string>();
  const picked: SourceFile[] = [];
  const add = (f: SourceFile) => {
    if (seen.has(f.path)) return;
    seen.add(f.path);
    picked.push({
      path: f.path,
      content:
        f.content.length > MAX_FILE_CHARS ? f.content.slice(0, MAX_FILE_CHARS) + "\n…" : f.content,
    });
  };

  const byPath = (needle: RegExp) => files.filter((f) => needle.test(f.path));

  // 1. config files
  for (const f of byPath(
    /(?:^|\/)(?:supabase\/config\.toml|firebase\.json|\.firebaserc|convex\.json|package\.json|\.env(?:\.[a-z]+)?)$/i,
  )) {
    add(f);
    if (picked.length >= MAX_CURATED_FILES) return picked;
  }
  // 2. detected signup hints
  for (const p of signals.signupHints) {
    const f = files.find((x) => x.path === p);
    if (f) add(f);
    if (picked.length >= MAX_CURATED_FILES) return picked;
  }
  // 3. common client integration paths (Lovable / Bolt / Next.js / v0)
  for (const f of byPath(
    /(?:integrations\/(?:supabase|firebase|convex)|lib\/(?:supabase|firebase|convex|db)|app\/(?:layout|providers?)|middleware\.ts$)/i,
  )) {
    add(f);
    if (picked.length >= MAX_CURATED_FILES) return picked;
  }
  // 4. any file that mentioned a URL/key we found
  const hitPaths = new Set([...signals.urls, ...signals.keys].map((s) => s.path));
  for (const p of hitPaths) {
    const f = files.find((x) => x.path === p);
    if (f) add(f);
    if (picked.length >= MAX_CURATED_FILES) return picked;
  }
  return picked;
}

function compactSignalsForPrompt(signals: RawSignals): string {
  return JSON.stringify(
    {
      urls: signals.urls.map((u) => ({ value: u.value, kind: u.kind })),
      keys: signals.keys.map((k) => ({ value: k.value, kind: k.kind, path: k.path })),
      configFiles: signals.configFiles,
      dependencies: signals.dependencies,
      envKeyNames: signals.envKeyNames,
      signupHints: signals.signupHints,
    },
    null,
    2,
  );
}

// ─── Layer 3 — anti-fabrication gate ────────────────────────────────────────

/**
 * Strip any `publicConfig` value the LLM emitted that doesn't correspond
 * verbatim to a signal from Layer 1. Every strip records a warning so the
 * downstream UI can surface "Kelp caught a hallucinated URL and removed
 * it" if we want to. Idempotent + total.
 */
export function validateReport(brief: BackendReport, signals: RawSignals): BackendReport {
  const allowedUrls = new Set(signals.urls.map((u) => u.value));
  const allowedKeys = new Set(signals.keys.map((k) => k.value));
  const allowedRefs = new Set(
    signals.urls
      .filter((u) => u.kind === "supabase")
      .map((u) => u.value.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1])
      .filter((v): v is string => Boolean(v)),
  );
  const allowedFirebaseProjectIds = new Set(
    signals.urls
      .filter((u) => u.kind === "firebase")
      .map((u) => u.value.match(/https:\/\/([a-z0-9-]+)\.firebase/)?.[1])
      .filter((v): v is string => Boolean(v)),
  );

  const stripped: string[] = [];
  const cleanConfig: BackendReport["publicConfig"] = {};

  const { publicConfig } = brief;
  if (publicConfig.supabaseUrl && allowedUrls.has(publicConfig.supabaseUrl)) {
    cleanConfig.supabaseUrl = publicConfig.supabaseUrl;
  } else if (publicConfig.supabaseUrl) {
    stripped.push("supabaseUrl");
  }
  if (publicConfig.supabaseRef && allowedRefs.has(publicConfig.supabaseRef)) {
    cleanConfig.supabaseRef = publicConfig.supabaseRef;
  } else if (publicConfig.supabaseRef) {
    stripped.push("supabaseRef");
  }
  if (publicConfig.supabaseAnonKey && allowedKeys.has(publicConfig.supabaseAnonKey)) {
    cleanConfig.supabaseAnonKey = publicConfig.supabaseAnonKey;
  } else if (publicConfig.supabaseAnonKey) {
    stripped.push("supabaseAnonKey");
  }
  if (
    publicConfig.firebaseProjectId &&
    allowedFirebaseProjectIds.has(publicConfig.firebaseProjectId)
  ) {
    cleanConfig.firebaseProjectId = publicConfig.firebaseProjectId;
  } else if (publicConfig.firebaseProjectId) {
    stripped.push("firebaseProjectId");
  }
  if (publicConfig.firebaseApiKey && allowedKeys.has(publicConfig.firebaseApiKey)) {
    cleanConfig.firebaseApiKey = publicConfig.firebaseApiKey;
  } else if (publicConfig.firebaseApiKey) {
    stripped.push("firebaseApiKey");
  }
  if (publicConfig.convexUrl && allowedUrls.has(publicConfig.convexUrl)) {
    cleanConfig.convexUrl = publicConfig.convexUrl;
  } else if (publicConfig.convexUrl) {
    stripped.push("convexUrl");
  }
  // customApiBaseUrl has no whitelist — we allow it through as the LLM's
  // best guess for now; downstream code treats it as advisory only.
  if (publicConfig.customApiBaseUrl) {
    cleanConfig.customApiBaseUrl = publicConfig.customApiBaseUrl;
  }

  const nextWarnings = [...brief.warnings];
  if (stripped.length > 0) {
    nextWarnings.push(
      `Kelp removed ${stripped.length} value(s) the analyzer proposed but couldn't verify in your repo: ${stripped.join(", ")}.`,
    );
  }

  return { ...brief, publicConfig: cleanConfig, warnings: nextWarnings };
}

// ─── Orchestration ──────────────────────────────────────────────────────────

/**
 * Analyze the repo. Two paths:
 *   · with driver → deterministic extraction + LLM interpretation + gate.
 *     If the LLM call throws, we fall back to the deterministic brief.
 *   · without driver → deterministic-only brief (fast, cheap, no LLM cost).
 *
 * Never throws. Never returns null.
 */
export async function analyzeBackend(
  files: readonly SourceFile[],
  opts: { driver?: LlmAgentDriver } = {},
): Promise<BackendReport> {
  const signals = extractRawSignals(files);
  if (!opts.driver) return fallbackReport(signals);

  const curated = curateFilesForAnalyzer(files, signals);
  const filesForPrompt = curated
    .map((f) => `--- ${f.path} ---\n${f.content}`)
    .join("\n\n");

  try {
    const step = await opts.driver.start({
      system: ANALYZER_SYSTEM,
      tools: [{ ...REPORT_TOOL }],
      prompt:
        "SIGNALS EXTRACTED FROM THE REPO (ground truth):\n" +
        compactSignalsForPrompt(signals) +
        "\n\nCURATED FILES:\n\n" +
        filesForPrompt +
        "\n\nCall report_brief exactly once with your interpretation.",
    });
    const call = step.toolCalls.find((c) => c.name === "report_brief");
    if (!call) return fallbackReport(signals);

    const raw = call.input as Partial<BackendReport> & {
      primary: BackendReport["primary"];
    };
    const brief: BackendReport = {
      version: 1,
      primary: raw.primary,
      ...(raw.secondary ? { secondary: raw.secondary } : {}),
      publicConfig: raw.publicConfig ?? {},
      authFlow: raw.authFlow ?? { providers: [], signupPath: null, narrative: "" },
      hints: raw.hints ?? [],
      warnings: raw.warnings ?? [],
      analyzedAt: new Date().toISOString(),
    };
    return validateReport(brief, signals);
  } catch {
    return fallbackReport(signals);
  }
}
