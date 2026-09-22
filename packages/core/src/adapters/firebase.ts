// FirebaseBackendAdapter — the second BackendAdapter (issue #38).
//
// Supabase gates data with Postgres RLS; Firebase gates it with a `.rules`
// file and serves it through Firestore / Cloud Storage / Cloud Functions.
// This adapter gives the scan pipeline the same four capabilities it has for
// Supabase, recovered from repo source alone:
//
//   detectFromRepo    — firebase.json / .firebaserc / *.rules / firebase SDK
//   parseSchema       — collections + their allow rules, out of firestore.rules
//   discoverFunctions — exported Cloud Functions under functions/
//   analyzeAuth       — delegated to the backend-agnostic auth-model helper
//
// The heavy detection (the actual rule misconfigurations) lives in the
// firebase-rules.ts scanner, the same split Supabase uses (adapter for the
// seam, scanner for the findings). This adapter is deliberately best-effort:
// Firestore is schemaless, so `parseSchema` reports the collection paths the
// rules mention rather than a real column graph.

import type { BackendAdapter, GenericBackendMeta, AuthModel } from "./backend-adapter.js";
import type { SourceFile } from "../scanners/secrets.js";
import type { TableIntel, TablePolicyIntel } from "../agent/autonomous.js";
import type { DiscoveredEdgeFunction } from "../agent/edge-functions.js";
import { buildAuthModelBrief } from "../agent/auth-model.js";

export const FIREBASE_TYPE = "firebase" as const;

interface FirebaseConfig {
  /** project id from .firebaserc `projects.default`, when present. */
  projectId: string | null;
  /** which sentinel files were found (for the dashboard + debugging). */
  markers: string[];
  hasFirestoreRules: boolean;
  hasStorageRules: boolean;
}

function findFile(files: readonly SourceFile[], re: RegExp): SourceFile | undefined {
  return files.find((f) => re.test(f.path));
}

function detectFirebaseConfig(files: readonly SourceFile[]): FirebaseConfig | null {
  const firebaseJson = findFile(files, /(?:^|\/)firebase\.json$/i);
  const firebaserc = findFile(files, /(?:^|\/)\.firebaserc$/i);
  const firestoreRules = findFile(files, /(?:^|\/)firestore\.rules$/i) ?? findFile(files, /\.rules$/i);
  const storageRules = findFile(files, /(?:^|\/)storage\.rules$/i);
  // SDK import as a soft signal, so a repo that only ships app code (rules
  // deployed elsewhere) still routes to this adapter.
  const sdkImport = files.some(
    (f) =>
      /\.[tj]sx?$/i.test(f.path) &&
      /(from\s+["']firebase(?:\/\w+)?["']|from\s+["']firebase-admin(?:\/\w+)?["']|require\(["']firebase(?:-admin)?["']\))/.test(
        f.content,
      ),
  );

  const markers: string[] = [];
  if (firebaseJson) markers.push("firebase.json");
  if (firebaserc) markers.push(".firebaserc");
  if (findFile(files, /(?:^|\/)firestore\.rules$/i)) markers.push("firestore.rules");
  if (storageRules) markers.push("storage.rules");
  if (sdkImport) markers.push("firebase-sdk");

  if (markers.length === 0) return null;

  let projectId: string | null = null;
  if (firebaserc) {
    try {
      const parsed = JSON.parse(firebaserc.content) as { projects?: Record<string, string> };
      projectId = parsed.projects?.default ?? null;
    } catch {
      projectId = null;
    }
  }

  return {
    projectId,
    markers,
    hasFirestoreRules: !!findFile(files, /(?:^|\/)firestore\.rules$/i) || (!!firestoreRules && /cloud\.firestore/.test(firestoreRules.content)),
    hasStorageRules: !!storageRules,
  };
}

// ── schema recovery from firestore.rules ────────────────────────────────

const RULE_MATCH_RE = /match\s+(\/[^\s{]+)\s*\{/g;
const ALLOW_RE = /allow\s+([a-z,\s]+?)\s*:\s*if\b([\s\S]*?);/gi;

// Turn `/users/{userId}` into a collection-ish name "users". Skips the
// synthetic Firestore root `/databases/{database}/documents`.
function collectionName(matchPath: string): string | null {
  const seg = matchPath.split("/").filter(Boolean)[0];
  if (!seg) return null;
  if (seg === "databases" || seg === "b") return null; // firestore/storage roots
  return seg.replace(/[{}=*]/g, "");
}

function parseFirestoreSchema(files: readonly SourceFile[]): TableIntel[] {
  const byName = new Map<string, TableIntel>();
  for (const f of files) {
    if (!/\.rules$/i.test(f.path)) continue;
    if (!/cloud\.firestore/.test(f.content) && !/firestore\.rules$/i.test(f.path)) continue;
    const content = f.content;

    // Pair each allow statement with the nearest preceding match path.
    const matches: { path: string; index: number }[] = [];
    RULE_MATCH_RE.lastIndex = 0;
    let mm: RegExpExecArray | null;
    while ((mm = RULE_MATCH_RE.exec(content))) matches.push({ path: mm[1]!, index: mm.index });

    ALLOW_RE.lastIndex = 0;
    let am: RegExpExecArray | null;
    while ((am = ALLOW_RE.exec(content))) {
      let enclosing = "/";
      for (const mt of matches) {
        if (mt.index < am.index) enclosing = mt.path;
        else break;
      }
      const name = collectionName(enclosing);
      if (!name) continue;
      const ops = am[1]!.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      const cond = am[2]!.trim();
      const t = byName.get(name) ?? {
        name,
        columns: [],
        rlsEnabled: true, // Firestore default-denies; rules are always "on".
        policies: [] as TablePolicyIntel[],
      };
      for (const op of ops) {
        t.policies.push({
          name: `${name}:${op}`,
          command: op,
          roles: [],
          using: cond,
          withCheck: null,
        });
      }
      byName.set(name, t);
    }
  }
  return [...byName.values()];
}

// ── Cloud Functions discovery ───────────────────────────────────────────

const V1_EXPORT_RE =
  /(?:exports\.([A-Za-z0-9_$]+)\s*=|export\s+const\s+([A-Za-z0-9_$]+)\s*=)[\s\S]{0,120}?functions[\s\S]{0,40}?\.(https|firestore|storage|pubsub|auth)\b/g;
const V2_EXPORT_RE =
  /export\s+const\s+([A-Za-z0-9_$]+)\s*=\s*(?:on(?:Request|Call|DocumentWritten|DocumentCreated|DocumentUpdated|DocumentDeleted|ObjectFinalized|Schedule)|beforeUserCreated)\s*\(/g;

const MUTATING_HINT = /\b(set|update|delete|create|add|write|remove|charge|admin|onDocument(?:Created|Updated|Deleted|Written)|onObjectFinalized)\b/i;

function discoverCloudFunctions(files: readonly SourceFile[]): DiscoveredEdgeFunction[] {
  const out: DiscoveredEdgeFunction[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    if (!/(?:^|\/)functions\//i.test(f.path)) continue;
    if (!/\.[tj]sx?$/i.test(f.path)) continue;
    const content = f.content;

    const hits: string[] = [];
    for (const re of [V1_EXPORT_RE, V2_EXPORT_RE]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content))) {
        const name = m[1] ?? m[2];
        if (name) hits.push(name);
      }
    }
    for (const name of hits) {
      const key = `${f.path}::${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const mutating = MUTATING_HINT.test(name) || MUTATING_HINT.test(content);
      out.push({
        name,
        path: f.path,
        bodyParams: [],
        queryParams: [],
        mutating,
        mutationReason: mutating ? "name or body suggests a write/admin operation" : null,
        identityParams: [],
        urlParams: [],
      });
    }
  }
  return out;
}

/**
 * The Firebase BackendAdapter. `analyzeAuth` delegates to the shared static
 * auth-model builder, same as Supabase: cookie-vs-bearer is backend-agnostic,
 * and Firebase's custom-claims nuance is a live-probe concern, not a static
 * one. The rule misconfigurations themselves are reported by the
 * firebase-rules.ts scanner, wired into the CLI + MCP scan surfaces.
 */
export const firebaseAdapter: BackendAdapter = {
  type: FIREBASE_TYPE,

  detectFromRepo(files: readonly SourceFile[]): GenericBackendMeta | null {
    const cfg = detectFirebaseConfig(files);
    if (!cfg) return null;
    return {
      type: FIREBASE_TYPE,
      label: "Firebase",
      config: {
        projectId: cfg.projectId,
        markers: cfg.markers,
        hasFirestoreRules: cfg.hasFirestoreRules,
        hasStorageRules: cfg.hasStorageRules,
      },
    };
  },

  parseSchema(files: readonly SourceFile[]): TableIntel[] {
    return parseFirestoreSchema(files);
  },

  discoverFunctions(files: readonly SourceFile[]): DiscoveredEdgeFunction[] {
    return discoverCloudFunctions(files);
  },

  analyzeAuth(files: readonly SourceFile[]): AuthModel {
    return buildAuthModelBrief(files);
  },
};
