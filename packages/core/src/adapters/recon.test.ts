// reconRepoViaRegistry — the exact mapping the worker relies on.
// Regression tests for review #45 blocking #1 (shape mismatch) and #2
// (silent recon regression). If these fail, scan-processor's repoConfig
// or env-less recon is broken again.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BackendAdapterRegistry } from "./backend-adapter.js";
import { supabaseAdapter } from "./supabase.js";
import { reconRepoViaRegistry } from "./recon.js";
import type { SourceFile } from "../scanners/secrets.js";

const f = (path: string, content: string): SourceFile => ({ path, content });

function testRegistry(): BackendAdapterRegistry {
  const r = new BackendAdapterRegistry();
  r.register(supabaseAdapter);
  return r;
}

const ANON_KEY = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.fake";

const envRepo: readonly SourceFile[] = [
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
    `VITE_SUPABASE_URL=https://abcdefghijklmnop.supabase.co\nVITE_SUPABASE_ANON_KEY=${ANON_KEY}`,
  ),
];

// Bolt/Lovable/Replit shape: Supabase surface, no committed env file.
const envLessRepo: readonly SourceFile[] = [
  f(
    "supabase/functions/get-report/index.ts",
    "Deno.serve(async (req) => { const { id } = await req.json(); return new Response(id); });",
  ),
  f(
    "supabase/migrations/0001_init.sql",
    "create table public.notes (id uuid primary key, body text);",
  ),
  f("src/App.tsx", "export default function App() { return null; }"),
];

test("blocking #1: repoConfig.url/ref/anonKey flow from backendMeta.config", () => {
  const recon = reconRepoViaRegistry(envRepo, testRegistry());
  assert.ok(recon.backend, "env repo must be claimed");
  assert.equal(recon.backend!.type, "supabase");
  assert.ok(recon.backendMeta, "backendMeta must be non-null");
  assert.ok(
    recon.repoConfig,
    "repoConfig must be set — the worker reads url/ref/anonKey from it",
  );
  assert.equal(recon.repoConfig!.url, "https://abcdefghijklmnop.supabase.co");
  assert.equal(recon.repoConfig!.ref, "abcdefghijklmnop");
  assert.equal(
    recon.repoConfig!.anonKey,
    ANON_KEY,
    "anonKey VALUE must survive (hasAnonKey boolean alone regressed this)",
  );
});

test("blocking #2: schema + functions survive with no env file", () => {
  const recon = reconRepoViaRegistry(envLessRepo, testRegistry());
  assert.equal(
    recon.backend,
    null,
    "no env URL means detect returns null (expected)",
  );
  assert.equal(recon.backendMeta, null);
  assert.equal(
    recon.repoConfig,
    null,
    "no detection means no repoConfig (worker falls back to stored creds)",
  );
  const names = recon.edgeFunctions.map((x) => x.name);
  assert.ok(
    names.includes("get-report"),
    `edge-fn recon must run without env file, got ${JSON.stringify(names)}`,
  );
  const tables = recon.repoSchema.map((t) => t.name);
  assert.ok(
    tables.includes("notes"),
    `schema recon must run without env file, got ${JSON.stringify(tables)}`,
  );
});

test("non-Supabase repo yields nulls and empty recon", () => {
  const recon = reconRepoViaRegistry(
    [f("package.json", "{}")],
    testRegistry(),
  );
  assert.equal(recon.backend, null);
  assert.equal(recon.backendMeta, null);
  assert.equal(recon.repoConfig, null);
  assert.deepEqual(recon.edgeFunctions, []);
  assert.deepEqual(recon.repoSchema, []);
});
