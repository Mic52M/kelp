// Registry contract: rejects bad adapters, accepts good ones, picks the
// right adapter on detect(). Supabase behavior-identity is covered in
// supabase.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BackendAdapterRegistry, type BackendAdapter, type BackendMeta } from "./backend-adapter.js";
import type { SourceFile } from "../scanners/secrets.js";
import type { TableIntel } from "../agent/autonomous.js";
import type { DiscoveredEdgeFunction } from "../agent/edge-functions.js";
import type { AuthModelBrief } from "../agent/auth-model.js";

const emptyFiles: readonly SourceFile[] = [];

function makeValidAdapter(type: string, detect: (files: readonly SourceFile[]) => BackendMeta | null = (_files: readonly SourceFile[]) => null): BackendAdapter {
  return {
    type,
    detectFromRepo: detect,
    parseSchema: (_files: readonly SourceFile[]): TableIntel[] => [],
    discoverFunctions: (_files: readonly SourceFile[]): DiscoveredEdgeFunction[] => [],
    analyzeAuth: (_files: readonly SourceFile[]): AuthModelBrief => ({
      primaryAuthMode: "none",
      hasCookieSessions: false,
      corsAllowsCredentials: false,
      corsWhitelistedOrigins: [],
      serverSidePriceRecalcHints: [],
      oneTimeTokenTables: [],
      narrative: "none",
    }),
  };
}

test("register() returns the same adapter and list() reports it", () => {
  const r = new BackendAdapterRegistry();
  const a = makeValidAdapter("test-one");
  const got = r.register(a);
  assert.equal(got, a, "register should return the registered adapter");
  assert.deepEqual(r.list(), ["test-one"]);
});

test("register() throws on a duplicate type", () => {
  const r = new BackendAdapterRegistry();
  r.register(makeValidAdapter("dup"));
  assert.throws(
    () => r.register(makeValidAdapter("dup")),
    /duplicate adapter for type "dup"/,
  );
});

test("register() rejects an adapter with an empty type string", () => {
  const r = new BackendAdapterRegistry();
  assert.throws(
    () => r.register(makeValidAdapter("")),
    /non-empty string/,
  );
});

test("register() rejects an adapter that is missing analyzeAuth", () => {
  const r = new BackendAdapterRegistry();
  const incomplete = {
    type: "incomplete",
    detectFromRepo: (_files: readonly SourceFile[]) => null,
    parseSchema: (_files: readonly SourceFile[]) => [],
    discoverFunctions: (_files: readonly SourceFile[]) => [],
  } as unknown as BackendAdapter;
  assert.throws(
    () => r.register(incomplete),
    /missing method "analyzeAuth"/,
  );
});

test("register() rejects an adapter whose detectFromRepo has the wrong arity", () => {
  const r = new BackendAdapterRegistry();
  const wrongArity = {
    type: "wrong-arity",
    detectFromRepo: (_a: unknown, _b: unknown, _c: unknown) => null,
    parseSchema: (_files: readonly SourceFile[]) => [],
    discoverFunctions: (_files: readonly SourceFile[]) => [],
    analyzeAuth: (_files: readonly SourceFile[]) => ({
      primaryAuthMode: "none" as const,
      hasCookieSessions: false,
      corsAllowsCredentials: false,
      corsWhitelistedOrigins: [],
      serverSidePriceRecalcHints: [],
      oneTimeTokenTables: [],
      narrative: "none",
    }),
  } as unknown as BackendAdapter;
  assert.throws(
    () => r.register(wrongArity),
    /arity 3/,
  );
});

test("register() rejects a non-function where a method should be", () => {
  const r = new BackendAdapterRegistry();
  const weird = {
    type: "weird",
    detectFromRepo: "not a function",
    parseSchema: (_files: readonly SourceFile[]) => [],
    discoverFunctions: (_files: readonly SourceFile[]) => [],
    analyzeAuth: (_files: readonly SourceFile[]) => ({
      primaryAuthMode: "none" as const,
      hasCookieSessions: false,
      corsAllowsCredentials: false,
      corsWhitelistedOrigins: [],
      serverSidePriceRecalcHints: [],
      oneTimeTokenTables: [],
      narrative: "none",
    }),
  } as unknown as BackendAdapter;
  assert.throws(
    () => r.register(weird),
    /missing method "detectFromRepo"/,
  );
});

test("detect() returns the first adapter that claims the repo", () => {
  const r = new BackendAdapterRegistry();
  const a = makeValidAdapter("a", (_files: readonly SourceFile[]) => ({ type: "a", label: "A", config: null }));
  const b = makeValidAdapter("b", (_files: readonly SourceFile[]) => ({ type: "b", label: "B", config: null }));
  r.register(a);
  r.register(b);
  assert.equal(r.detect(emptyFiles), a, "a was registered first and claims the repo");
});

test("detect() returns null when no adapter matches", () => {
  const r = new BackendAdapterRegistry();
  r.register(makeValidAdapter("a", (_files: readonly SourceFile[]) => null));
  r.register(makeValidAdapter("b", (_files: readonly SourceFile[]) => null));
  assert.equal(r.detect(emptyFiles), null);
});

test("get() returns a registered adapter by type, undefined otherwise", () => {
  const r = new BackendAdapterRegistry();
  const a = makeValidAdapter("a");
  r.register(a);
  assert.equal(r.get("a"), a);
  assert.equal(r.get("nope"), undefined);
});