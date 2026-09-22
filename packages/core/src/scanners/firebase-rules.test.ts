// Firebase Security Rules analyzer tests. Issue #38.
// VULN/CONTROL pair per rule, plus the opaque-helper and service-detection
// cases that pin down the evaluator's deliberate err-toward-silence behavior.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SourceFile } from "./secrets.js";
import { analyzeFirebaseRules } from "./firebase-rules.js";

function rules(path: string, content: string): SourceFile {
  return { path, content };
}

// ── FIREBASE-01: public (if true) ──────────────────────────────────────

test("VULN: allow read, write: if true on Firestore is critical + public", () => {
  const f = rules(
    "firestore.rules",
    `rules_version = '2';
     service cloud.firestore {
       match /databases/{database}/documents {
         match /notes/{noteId} {
           allow read, write: if true;
         }
       }
     }`,
  );
  const out = analyzeFirebaseRules([f]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.issue, "firebase_rule_public");
  assert.equal(out[0]!.severity, "critical");
  assert.equal(out[0]!.confidence, "high");
  assert.equal(out[0]!.service, "firestore");
  assert.equal(out[0]!.matchPath, "/notes/{noteId}");
});

test("public read-only rule is high, not critical", () => {
  const f = rules(
    "firestore.rules",
    `service cloud.firestore {
       match /d/{d}/documents {
         match /public/{id} { allow read: if true; }
       }
     }`,
  );
  const out = analyzeFirebaseRules([f]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.severity, "high");
});

test("CONTROL: owner-scoped write is not flagged", () => {
  const f = rules(
    "firestore.rules",
    `service cloud.firestore {
       match /d/{d}/documents {
         match /users/{userId} {
           allow read: if request.auth != null;
           allow write: if request.auth.uid == userId;
         }
       }
     }`,
  );
  assert.equal(analyzeFirebaseRules([f]).length, 0);
});

// ── FIREBASE-02: unauthenticated write ─────────────────────────────────

test("VULN: write with no request.auth reference is an unauthenticated write", () => {
  const f = rules(
    "firestore.rules",
    `service cloud.firestore {
       match /d/{d}/documents {
         match /submissions/{id} {
           allow create: if request.resource.data.size() < 500;
         }
       }
     }`,
  );
  const out = analyzeFirebaseRules([f]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.issue, "firebase_rule_unauthenticated_write");
  assert.equal(out[0]!.severity, "high");
});

// ── FIREBASE-03: authenticated write, no owner binding ─────────────────

test("VULN: signed-in write with no owner check is flagged", () => {
  const f = rules(
    "firestore.rules",
    `service cloud.firestore {
       match /d/{d}/documents {
         match /posts/{postId} {
           allow write: if request.auth != null;
         }
       }
     }`,
  );
  const out = analyzeFirebaseRules([f]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.issue, "firebase_rule_write_no_owner");
  assert.equal(out[0]!.severity, "high");
  assert.equal(out[0]!.confidence, "medium");
});

test("CONTROL: write bound to owner via resource.data is not flagged", () => {
  const f = rules(
    "firestore.rules",
    `service cloud.firestore {
       match /d/{d}/documents {
         match /orders/{id} {
           allow update: if request.auth != null && resource.data.ownerId == request.auth.uid;
         }
       }
     }`,
  );
  assert.equal(analyzeFirebaseRules([f]).length, 0);
});

// ── opaque helper functions: err toward silence ────────────────────────

test("a write gated on a local function() is treated as guarded (no false positive)", () => {
  const f = rules(
    "firestore.rules",
    `service cloud.firestore {
       match /d/{d}/documents {
         function isOwner(userId) { return request.auth.uid == userId; }
         match /users/{userId} {
           allow write: if isOwner(userId);
         }
       }
     }`,
  );
  assert.equal(
    analyzeFirebaseRules([f]).length,
    0,
    "cannot see inside the helper, so stay silent rather than cry wolf",
  );
});

test("but if true still fires even when helper functions are defined", () => {
  const f = rules(
    "firestore.rules",
    `service cloud.firestore {
       function isSignedIn() { return request.auth != null; }
       match /d/{d}/documents {
         match /open/{id} { allow read, write: if true; }
       }
     }`,
  );
  const out = analyzeFirebaseRules([f]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.issue, "firebase_rule_public");
});

// ── storage rules + service detection ──────────────────────────────────

test("VULN: public Storage bucket rule is detected as storage service", () => {
  const f = rules(
    "storage.rules",
    `service firebase.storage {
       match /b/{bucket}/o {
         match /{allPaths=**} {
           allow read, write: if true;
         }
       }
     }`,
  );
  const out = analyzeFirebaseRules([f]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.service, "storage");
  assert.equal(out[0]!.severity, "critical");
  assert.ok(/Storage/.test(out[0]!.title));
});

// ── multi-rule file + ordering + fingerprints ──────────────────────────

test("orders findings by severity and keeps stable unique fingerprints", () => {
  const f = rules(
    "firestore.rules",
    `service cloud.firestore {
       match /d/{d}/documents {
         match /a/{id} { allow read: if true; }
         match /b/{id} { allow write: if true; }
         match /c/{id} { allow write: if request.auth != null; }
       }
     }`,
  );
  const a = analyzeFirebaseRules([f]);
  const b = analyzeFirebaseRules([f]);
  assert.equal(a.length, 3);
  // critical (public write) before high (public read / no-owner write)
  assert.equal(a[0]!.severity, "critical");
  assert.deepEqual(
    a.map((x) => x.fingerprint),
    b.map((x) => x.fingerprint),
  );
  assert.equal(new Set(a.map((x) => x.fingerprint)).size, 3);
});

test("a non-rules file is ignored", () => {
  const f = rules("src/app.ts", `const allow = "read, write: if true";`);
  assert.equal(analyzeFirebaseRules([f]).length, 0);
});
