// SupabaseBackendAdapter — behavior-identity smoke test. Confirms the thin
// wrappers actually delegate to the existing functions. Deep coverage of
// the underlying logic lives in `agent/repo-recon.test.ts` and
// `agent/edge-functions.test.ts` — this test just proves the seam.

import { test } from "node:test";
import assert from "node:assert/strict";
import { supabaseAdapter, SUPABASE_TYPE } from "./supabase.js";
import { isSupabaseBackendMeta } from "./backend-adapter.js";
import type { SourceFile } from "../scanners/secrets.js";

const f = (path: string, content: string): SourceFile => ({ path, content });

const fakeSupabaseRepo: readonly SourceFile[] = [
  f(
    "supabase/functions/get-report/index.ts",
    "Deno.serve(async (req) => { const { id } = await req.json(); return new Response(id); });",
  ),
  f(
    "supabase/migrations/0001_init.sql",
    "create table public.notes (id uuid primary key, body text);",
  ),
  f(
    ".env",
    "VITE_SUPABASE_URL=https://abcdefghijklmnop.supabase.co\nVITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.fake",
  ),
];

test("type is the constant 'supabase'", () => {
  assert.equal(supabaseAdapter.type, SUPABASE_TYPE);
  assert.equal(supabaseAdapter.type, "supabase");
});

test("detectFromRepo returns a BackendMeta on a Supabase-shaped repo", () => {
  const meta = supabaseAdapter.detectFromRepo(fakeSupabaseRepo);
  assert.ok(meta, "must not be null on a Supabase repo");
  assert.equal(meta!.type, "supabase");
  assert.equal(meta!.label, "Supabase");
  // Discriminated union: the guard narrows `config` to the typed shape
  // (review #45 option a). Assert the value flows through, not just the hint.
  assert.ok(meta! && isSupabaseBackendMeta(meta!), "must narrow to SupabaseBackendMeta");
  if (meta! && isSupabaseBackendMeta(meta!)) {
    assert.equal(meta!.config.url, "https://abcdefghijklmnop.supabase.co");
    assert.equal(meta!.config.ref, "abcdefghijklmnop");
    assert.equal(meta!.config.hasAnonKey, true);
    assert.ok(
      typeof meta!.config.anonKey === "string" && meta!.config.anonKey.length > 0,
      "anonKey value must be preserved for worker recon (blocking #1)",
    );
  }
});

test("detectFromRepo returns null on a non-Supabase repo", () => {
  assert.equal(
    supabaseAdapter.detectFromRepo([f("package.json", "{}")]),
    null,
  );
});

test("parseSchema returns TableIntel[] for the migrations in the repo", () => {
  const intel = supabaseAdapter.parseSchema(fakeSupabaseRepo);
  assert.ok(Array.isArray(intel), "must be an array");
  // Pin shape + content (not just `length >= 0`, which is always true):
  // the fake migration creates public.notes, so the adapter must surface it
  // with the TableIntel fields the worker relies on.
  const names = intel.map((t) => t.name);
  assert.ok(
    names.includes("notes"),
    `expected notes table from migrations, got ${JSON.stringify(names)}`,
  );
  for (const t of intel) {
    assert.equal(typeof t.name, "string");
    assert.ok(Array.isArray(t.columns), `columns must be an array for ${t.name}`);
    assert.equal(typeof t.rlsEnabled, "boolean");
    assert.ok(Array.isArray(t.policies), `policies must be an array for ${t.name}`);
  }
});

test("discoverFunctions finds the edge function in supabase/functions/", () => {
  const fns = supabaseAdapter.discoverFunctions(fakeSupabaseRepo);
  const names = fns.map((x) => x.name);
  assert.ok(names.includes("get-report"), `expected get-report, got ${JSON.stringify(names)}`);
});

test("analyzeAuth returns an AuthModelBrief-shaped object", () => {
  const auth = supabaseAdapter.analyzeAuth(fakeSupabaseRepo);
  assert.equal(typeof auth.primaryAuthMode, "string");
  assert.ok(["cookie_session", "bearer_jwt", "mixed", "none"].includes(auth.primaryAuthMode));
  assert.equal(typeof auth.hasCookieSessions, "boolean");
  assert.equal(typeof auth.corsAllowsCredentials, "boolean");
  assert.ok(Array.isArray(auth.corsWhitelistedOrigins));
  assert.ok(Array.isArray(auth.serverSidePriceRecalcHints));
  assert.ok(Array.isArray(auth.oneTimeTokenTables));
  assert.equal(typeof auth.narrative, "string");
});
