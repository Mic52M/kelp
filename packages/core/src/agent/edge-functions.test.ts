import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverEdgeFunctions, edgeFunctionUrl } from "./edge-functions.js";
import type { SourceFile } from "../scanners/secrets.js";

function f(path: string, content: string): SourceFile {
  return { path, content };
}

test("discovers functions under supabase/functions, ignores _shared and non-index", () => {
  const files: SourceFile[] = [
    f("supabase/functions/check-subscription/index.ts", "const { } = await req.json()"),
    f("supabase/functions/_shared/cors.ts", "export const cors = {}"),
    f("supabase/functions/ai-coach/helper.ts", "// not an index"),
    f("src/App.tsx", "export default function App(){}"),
  ];
  const found = discoverEdgeFunctions(files);
  assert.deepEqual(found.map((x) => x.name), ["check-subscription"]);
});

test("extracts body + query params", () => {
  const src = `
    const { email, targetUserId, note } = await req.json();
    const q = url.searchParams.get("since");
  `;
  const [fn] = discoverEdgeFunctions([f("supabase/functions/get-report/index.ts", src)]);
  assert.deepEqual(fn!.bodyParams.sort(), ["email", "note", "targetUserId"]);
  assert.deepEqual(fn!.queryParams, ["since"]);
});

test("classifies read-only vs mutating by name", () => {
  const read = discoverEdgeFunctions([f("supabase/functions/check-subscription/index.ts", "await req.json()")])[0]!;
  const del = discoverEdgeFunctions([f("supabase/functions/delete-account/index.ts", "await req.json()")])[0]!;
  assert.equal(read.mutating, false);
  assert.equal(del.mutating, true);
  assert.match(del.mutationReason!, /write verb/);
});

test("classifies mutating by body content even with a safe name", () => {
  const src = `
    const { id } = await req.json();
    await supabase.from("orders").insert({ id });
  `;
  const fn = discoverEdgeFunctions([f("supabase/functions/log-order/index.ts", src)])[0]!;
  // "log" isn't a write-verb name, but the .insert( makes it mutating.
  assert.equal(fn.mutating, true);
  assert.match(fn.mutationReason!, /writes to the database/);
});

test("flags Stripe checkout creation as mutating", () => {
  const src = `const s = await stripe.checkout.sessions.create({});`;
  const fn = discoverEdgeFunctions([f("supabase/functions/pay-now/index.ts", src)])[0]!;
  assert.equal(fn.mutating, true);
});

test("identifies identity + url capability params", () => {
  const src = `const { user_id, avatar_url, comment } = await req.json();`;
  const fn = discoverEdgeFunctions([f("supabase/functions/fetch-avatar/index.ts", src)])[0]!;
  assert.deepEqual(fn.identityParams, ["user_id"]);
  assert.deepEqual(fn.urlParams, ["avatar_url"]);
});

test("edgeFunctionUrl builds the deploy URL", () => {
  assert.equal(
    edgeFunctionUrl("abcd1234", "check-subscription"),
    "https://abcd1234.supabase.co/functions/v1/check-subscription",
  );
});
