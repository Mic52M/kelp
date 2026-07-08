import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSupabaseConfig, parseRepoSchema } from "./repo-recon.js";
import type { SourceFile } from "../scanners/secrets.js";

const f = (path: string, content: string): SourceFile => ({ path, content });

// A real anon JWT has role:"anon" in the payload. Build a tiny one.
function anonJwt(): string {
  const payload = Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url");
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.c2ln`;
}
function serviceJwt(): string {
  const payload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.c2ln`;
}

test("detects url + anon key + ref from .env", () => {
  const cfg = detectSupabaseConfig([
    f(".env", `VITE_SUPABASE_URL="https://efxekrurelfpvhxvhaqn.supabase.co"\nVITE_SUPABASE_PUBLISHABLE_KEY="${anonJwt()}"`),
  ]);
  assert.ok(cfg);
  assert.equal(cfg!.url, "https://efxekrurelfpvhxvhaqn.supabase.co");
  assert.equal(cfg!.ref, "efxekrurelfpvhxvhaqn");
  assert.equal(cfg!.anonKey, anonJwt());
});

test("NEVER picks up a service_role key as the anon key", () => {
  const cfg = detectSupabaseConfig([
    f(".env", `VITE_SUPABASE_URL="https://abcd1234efgh5678ijkl.supabase.co"`),
    f("supabase/functions/x/index.ts", `const KEY="${serviceJwt()}"`),
  ]);
  assert.ok(cfg);
  assert.equal(cfg!.anonKey, null); // service_role ignored; no anon found
});

test("detects the new sb_publishable_ key format", () => {
  const cfg = detectSupabaseConfig([
    f(".env", `VITE_SUPABASE_URL=https://abcd1234efgh5678ijkl.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_AbCdEf123456`),
  ]);
  assert.equal(cfg!.anonKey, "sb_publishable_AbCdEf123456");
});

test("returns null when no supabase url is present", () => {
  assert.equal(detectSupabaseConfig([f("package.json", "{}")]), null);
});

test("parses tables+columns from types.ts and RLS from migrations", () => {
  const types = `
export type Database = {
  public: {
    Tables: {
      products: {
        Row: {
          id: string
          title: string | null
          is_published: boolean
        }
        Insert: { id?: string }
      }
      profiles: {
        Row: {
          id: string
          email: string | null
        }
        Insert: {}
      }
    }
  }
}`;
  const mig = `
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products_public_read" ON public.products FOR SELECT USING (is_published = true);
CREATE POLICY "profiles_self" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "categories_public" ON public.categories FOR SELECT USING (true);`;
  const schema = parseRepoSchema([
    f("src/integrations/supabase/types.ts", types),
    f("supabase/migrations/0001_init.sql", mig),
  ]);
  const byName = new Map(schema.map((t) => [t.name, t]));

  const products = byName.get("products")!;
  assert.ok(products);
  assert.deepEqual(products.columns.map((c) => c.name), ["id", "title", "is_published"]);
  assert.equal(products.rlsEnabled, true);
  assert.equal(products.policies[0]!.command, "SELECT");
  assert.match(products.policies[0]!.using!, /is_published/);

  // A permissive USING(true) policy is captured verbatim so the agent can flag it.
  const categories = byName.get("categories")!;
  assert.ok(categories, "table seen only in a policy is still surfaced");
  assert.equal(categories.policies[0]!.using, "true");
});

test("a later migration dropping a policy removes it from the net state", () => {
  const schema = parseRepoSchema([
    f("supabase/migrations/0001.sql", `CREATE POLICY "p1" ON public.orders FOR SELECT USING (true);`),
    f("supabase/migrations/0002.sql", `DROP POLICY "p1" ON public.orders;`),
  ]);
  const orders = schema.find((t) => t.name === "orders");
  assert.ok(orders);
  assert.equal(orders!.policies.length, 0);
});
