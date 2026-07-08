import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBackendBrief } from "./backend-brief.js";
import type { SourceFile } from "../scanners/secrets.js";
import type { DiscoveredEdgeFunction } from "./edge-functions.js";

const f = (path: string, content: string): SourceFile => ({ path, content });
const ef = (over: Partial<DiscoveredEdgeFunction> & { name: string }): DiscoveredEdgeFunction => ({
  path: `supabase/functions/${over.name}/index.ts`,
  bodyParams: [], queryParams: [], mutating: false, mutationReason: null,
  identityParams: [], urlParams: [], ...over,
});

test("extracts a SECURITY DEFINER function + flags missing search_path", () => {
  const brief = buildBackendBrief(
    [
      f(
        "supabase/migrations/0001_init.sql",
        `create or replace function public.has_role(u uuid, r text)
         returns boolean
         language plpgsql
         security definer
         as $$
         begin
           return exists (select 1 from user_roles where user_id = u and role = r);
         end;
         $$;`,
      ),
    ],
    [],
  );
  assert.equal(brief.rpcFunctions.length, 1);
  const fn = brief.rpcFunctions[0]!;
  assert.equal(fn.name, "has_role");
  assert.equal(fn.qualifiedName, "public.has_role");
  assert.equal(fn.securityDefiner, true);
  assert.equal(fn.hasSetSearchPath, false);
  assert.equal(fn.language, "plpgsql");
  assert.match(fn.body, /user_roles/);
});

test("recognises SET search_path (the DEFINER mitigation)", () => {
  const brief = buildBackendBrief(
    [
      f(
        "supabase/migrations/0002.sql",
        `create function public.is_staff(u uuid) returns boolean
         language sql security definer
         set search_path = public
         as $$ select true $$;`,
      ),
    ],
    [],
  );
  assert.equal(brief.rpcFunctions[0]!.hasSetSearchPath, true);
  assert.equal(brief.rpcFunctions[0]!.language, "sql");
});

test("later migrations replace earlier definitions (last-wins)", () => {
  const brief = buildBackendBrief(
    [
      f(
        "supabase/migrations/0001.sql",
        `create function public.f() returns void language sql as $$ select 1 $$;`,
      ),
      f(
        "supabase/migrations/0002.sql",
        `create or replace function public.f() returns void language sql security definer as $$ select 2 $$;`,
      ),
    ],
    [],
  );
  assert.equal(brief.rpcFunctions.length, 1);
  assert.equal(brief.rpcFunctions[0]!.securityDefiner, true);
  assert.match(brief.rpcFunctions[0]!.body, /select 2/);
});

test("edge summaries carry verify_jwt from config.toml", () => {
  const brief = buildBackendBrief(
    [
      f(
        "supabase/config.toml",
        `[functions.add-user-role]\nverify_jwt = false\n[functions.check-subscription]\nverify_jwt = true`,
      ),
    ],
    [
      ef({ name: "add-user-role", mutating: true, mutationReason: "write verb" }),
      ef({ name: "check-subscription" }),
      ef({ name: "unknown-fn" }),
    ],
  );
  const byName = new Map(brief.edgeFunctions.map((e) => [e.name, e]));
  assert.equal(byName.get("add-user-role")!.verifyJwt, false);
  assert.equal(byName.get("check-subscription")!.verifyJwt, true);
  assert.equal(byName.get("unknown-fn")!.verifyJwt, null);
});

test("humanText mentions functions, verify_jwt, and the 'skip source grep' guidance", () => {
  const brief = buildBackendBrief(
    [
      f(
        "supabase/migrations/0001.sql",
        `create function public.has_role() returns void language sql security definer as $$ select 1 $$;`,
      ),
      f("supabase/config.toml", `[functions.x]\nverify_jwt = false`),
    ],
    [ef({ name: "x" })],
  );
  assert.match(brief.humanText, /has_role/);
  assert.match(brief.humanText, /SECURITY DEFINER/);
  assert.match(brief.humanText, /verify_jwt=false/);
  assert.match(brief.humanText, /Skip .*list_source_files/);
});
