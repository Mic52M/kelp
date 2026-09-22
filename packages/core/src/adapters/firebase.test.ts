// Firebase backend adapter tests (issue #38). Covers the four interface
// methods plus registration in a fresh registry and coexistence with the
// Supabase adapter's detection.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SourceFile } from "../scanners/secrets.js";
import { firebaseAdapter, FIREBASE_TYPE } from "./firebase.js";
import { supabaseAdapter } from "./supabase.js";
import { BackendAdapterRegistry } from "./backend-adapter.js";

function f(path: string, content: string): SourceFile {
  return { path, content };
}

const FIRESTORE_RULES = f(
  "firestore.rules",
  `service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId} {
         allow read: if request.auth != null;
         allow write: if request.auth.uid == userId;
       }
       match /posts/{postId} {
         allow read, write: if true;
       }
     }
   }`,
);

const FIREBASERC = f(".firebaserc", `{ "projects": { "default": "my-cool-app" } }`);

// ── detectFromRepo ─────────────────────────────────────────────────────

test("detectFromRepo matches on firebase.json + .firebaserc and reads projectId", () => {
  const meta = firebaseAdapter.detectFromRepo([
    f("firebase.json", `{ "firestore": { "rules": "firestore.rules" } }`),
    FIREBASERC,
    FIRESTORE_RULES,
  ]);
  assert.ok(meta);
  assert.equal(meta!.type, FIREBASE_TYPE);
  assert.equal(meta!.label, "Firebase");
  const cfg = meta!.config as Record<string, unknown>;
  assert.equal(cfg.projectId, "my-cool-app");
  assert.equal(cfg.hasFirestoreRules, true);
  assert.deepEqual(
    (cfg.markers as string[]).includes("firebase.json"),
    true,
  );
});

test("detectFromRepo matches on a firebase SDK import alone", () => {
  const meta = firebaseAdapter.detectFromRepo([
    f("src/lib/db.ts", `import { getFirestore } from "firebase/firestore";`),
  ]);
  assert.ok(meta, "an SDK import is a soft detection signal");
  assert.equal(meta!.type, FIREBASE_TYPE);
});

test("detectFromRepo returns null on a repo with no Firebase signal", () => {
  const meta = firebaseAdapter.detectFromRepo([
    f("src/index.ts", `export const x = 1;`),
    f("supabase/config.toml", `project_id = "abc"`),
  ]);
  assert.equal(meta, null);
});

// ── parseSchema ────────────────────────────────────────────────────────

test("parseSchema recovers collections + their allow rules from firestore.rules", () => {
  const tables = firebaseAdapter.parseSchema([FIRESTORE_RULES]);
  const names = tables.map((t) => t.name).sort();
  assert.deepEqual(names, ["posts", "users"]);
  const users = tables.find((t) => t.name === "users")!;
  assert.equal(users.rlsEnabled, true);
  const commands = users.policies.map((p) => p.command).sort();
  assert.deepEqual(commands, ["read", "write"]);
});

// ── discoverFunctions ──────────────────────────────────────────────────

test("discoverFunctions finds v1 and v2 Cloud Functions and flags writes", () => {
  const fns = firebaseAdapter.discoverFunctions([
    f(
      "functions/src/index.ts",
      `import * as functions from "firebase-functions";
       import { onCall } from "firebase-functions/v2/https";
       exports.api = functions.https.onRequest((req, res) => res.send("ok"));
       export const deleteUser = onCall(async (req) => { await admin.firestore().doc("x").delete(); });`,
    ),
  ]);
  const names = fns.map((x) => x.name).sort();
  assert.deepEqual(names, ["api", "deleteUser"]);
  const del = fns.find((x) => x.name === "deleteUser")!;
  assert.equal(del.mutating, true);
});

test("discoverFunctions ignores files outside functions/", () => {
  const fns = firebaseAdapter.discoverFunctions([
    f("src/app.ts", `export const foo = onRequest(() => {});`),
  ]);
  assert.equal(fns.length, 0);
});

// ── analyzeAuth ────────────────────────────────────────────────────────

test("analyzeAuth returns a well-formed auth model", () => {
  const model = firebaseAdapter.analyzeAuth([FIRESTORE_RULES]);
  assert.ok(
    ["cookie_session", "bearer_jwt", "mixed", "none"].includes(model.primaryAuthMode),
  );
});

// ── registry integration ───────────────────────────────────────────────

test("registers cleanly and detect() picks Firebase for a Firebase repo", () => {
  const reg = new BackendAdapterRegistry();
  reg.register(supabaseAdapter);
  reg.register(firebaseAdapter);
  assert.deepEqual(reg.list(), ["supabase", "firebase"]);

  const picked = reg.detect([f("firebase.json", `{}`), FIREBASERC]);
  assert.ok(picked);
  assert.equal(picked!.type, FIREBASE_TYPE);
});

test("a Supabase repo still resolves to Supabase with both registered", () => {
  const reg = new BackendAdapterRegistry();
  reg.register(supabaseAdapter);
  reg.register(firebaseAdapter);
  const picked = reg.detect([
    f("supabase/config.toml", `project_id = "abcdefghijklmnop"`),
    f(".env", `VITE_SUPABASE_URL=https://abcdefghijklmnop.supabase.co`),
  ]);
  assert.ok(picked);
  assert.equal(picked!.type, "supabase");
});
