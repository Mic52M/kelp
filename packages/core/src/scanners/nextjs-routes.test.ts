// Unauthenticated Next.js route / server action analyzer tests. Issue #65.
// A VULN/CONTROL pair for every branch, plus noise-suppression cases that
// pin down the heuristic's deliberate false-negative behavior.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SourceFile } from "./secrets.js";
import { analyzeNextjsRoutes } from "./nextjs-routes.js";

function file(path: string, content: string): SourceFile {
  return { path, content };
}

// ── route handlers: mutations ──────────────────────────────────────────

test("VULN: POST route handler with a DB write and no auth is flagged", () => {
  const f = file(
    "app/api/orders/route.ts",
    `import { createClient } from "@/lib/supabase";
     export async function POST(req: Request) {
       const supabase = createClient();
       const body = await req.json();
       await supabase.from("orders").insert(body);
       return Response.json({ ok: true });
     }`,
  );
  const out = analyzeNextjsRoutes([f]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.issue, "route_handler_no_auth");
  assert.equal(out[0]!.method, "POST");
  assert.equal(out[0]!.severity, "medium");
  assert.equal(out[0]!.confidence, "medium");
  assert.equal(out[0]!.path, "app/api/orders/route.ts");
});

test("CONTROL: same POST route with getUser() is not flagged", () => {
  const f = file(
    "app/api/orders/route.ts",
    `import { createClient } from "@/lib/supabase";
     export async function POST(req: Request) {
       const supabase = createClient();
       const { data: { user } } = await supabase.auth.getUser();
       if (!user) return new Response("no", { status: 401 });
       await supabase.from("orders").insert(await req.json());
       return Response.json({ ok: true });
     }`,
  );
  assert.equal(analyzeNextjsRoutes([f]).length, 0);
});

// ── route handlers: reads (GET gated on a data signal) ─────────────────

test("VULN: GET route that reads a backend with no auth is flagged (low)", () => {
  const f = file(
    "app/api/profile/route.ts",
    `import { prisma } from "@/lib/db";
     export async function GET() {
       const rows = await prisma.user.findMany();
       return Response.json(rows);
     }`,
  );
  const out = analyzeNextjsRoutes([f]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.method, "GET");
  assert.equal(out[0]!.severity, "low", "reads are down-ranked vs mutations");
});

test("CONTROL: GET route with no backend/data signal stays quiet", () => {
  const f = file(
    "app/api/health/route.ts",
    `export async function GET() {
       return Response.json({ status: "ok" });
     }`,
  );
  assert.equal(
    analyzeNextjsRoutes([f]).length,
    0,
    "a trivial public health check must not be flagged",
  );
});

// ── const-form export ──────────────────────────────────────────────────

test("VULN: export const DELETE = async () arrow handler is flagged", () => {
  const f = file(
    "app/api/items/[id]/route.ts",
    `import { db } from "@/db";
     export const DELETE = async (req: Request) => {
       await db.delete("items");
       return new Response(null, { status: 204 });
     };`,
  );
  const out = analyzeNextjsRoutes([f]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.method, "DELETE");
  assert.equal(out[0]!.severity, "medium");
});

// ── webhook exception ──────────────────────────────────────────────────

test("CONTROL: a Stripe webhook verified with constructEvent is not flagged", () => {
  const f = file(
    "app/api/webhook/route.ts",
    `import Stripe from "stripe";
     const stripe = new Stripe(process.env.STRIPE_KEY!);
     export async function POST(req: Request) {
       const sig = req.headers.get("stripe-signature")!;
       const event = stripe.webhooks.constructEvent(await req.text(), sig, secret);
       await db.from("events").insert(event);
       return Response.json({ received: true });
     }`,
  );
  assert.equal(
    analyzeNextjsRoutes([f]).length,
    0,
    "signature verification counts as auth for webhooks",
  );
});

// ── legacy pages/api ───────────────────────────────────────────────────

test("VULN: legacy pages/api default handler with a DB call and no auth", () => {
  const f = file(
    "pages/api/orders.ts",
    `import { supabase } from "@/lib/supabase";
     export default async function handler(req, res) {
       const { data } = await supabase.from("orders").select("*");
       res.json(data);
     }`,
  );
  const out = analyzeNextjsRoutes([f]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.method, "ANY");
  assert.equal(out[0]!.severity, "medium");
});

test("CONTROL: pages/api handler that calls getServerSession is not flagged", () => {
  const f = file(
    "pages/api/orders.ts",
    `import { getServerSession } from "next-auth";
     export default async function handler(req, res) {
       const session = await getServerSession(req, res, authOptions);
       if (!session) return res.status(401).end();
       const { data } = await supabase.from("orders").select("*");
       res.json(data);
     }`,
  );
  assert.equal(analyzeNextjsRoutes([f]).length, 0);
});

// ── server actions ─────────────────────────────────────────────────────

test("VULN: use-server action reading formData with no auth is flagged", () => {
  const f = file(
    "app/actions.ts",
    `"use server";
     import { db } from "@/db";
     export async function createPost(formData: FormData) {
       const title = formData.get("title");
       await db.insert("posts", { title });
     }`,
  );
  const out = analyzeNextjsRoutes([f]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.issue, "server_action_no_auth");
  assert.equal(out[0]!.name, "createPost");
  assert.equal(out[0]!.severity, "medium");
});

test("CONTROL: use-server action that checks the session is not flagged", () => {
  const f = file(
    "app/actions.ts",
    `"use server";
     import { auth } from "@/auth";
     export async function createPost(formData: FormData) {
       const session = await auth();
       if (!session?.user) throw new Error("unauthorized");
       await db.insert("posts", { title: formData.get("title") });
     }`,
  );
  assert.equal(analyzeNextjsRoutes([f]).length, 0);
});

test("a use-server file with several unauthenticated actions flags each once", () => {
  const f = file(
    "app/actions.ts",
    `"use server";
     import { db } from "@/db";
     export async function createPost(formData: FormData) { await db.insert("posts", {}); }
     export const deletePost = async (formData: FormData) => { await db.delete("posts"); };`,
  );
  const out = analyzeNextjsRoutes([f]);
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((o) => o.name).sort(),
    ["createPost", "deletePost"],
  );
});

// ── scoping / non-candidates ───────────────────────────────────────────

test("a plain component file that is not a route or action is ignored", () => {
  const f = file(
    "app/dashboard/page.tsx",
    `export default function Page() { return <div>hi</div>; }`,
  );
  assert.equal(analyzeNextjsRoutes([f]).length, 0);
});

test("fingerprints are stable across runs and unique per handler", () => {
  const f = file(
    "app/api/x/route.ts",
    `import { db } from "@/db";
     export async function POST() { await db.insert("x", {}); return Response.json({}); }
     export async function DELETE() { await db.delete("x"); return new Response(null); }`,
  );
  const a = analyzeNextjsRoutes([f]);
  const b = analyzeNextjsRoutes([f]);
  assert.equal(a.length, 2);
  assert.deepEqual(
    a.map((x) => x.fingerprint),
    b.map((x) => x.fingerprint),
  );
  assert.notEqual(a[0]!.fingerprint, a[1]!.fingerprint);
});

test("findings come back severity-ordered (mutations before reads)", () => {
  const files = [
    file(
      "app/api/read/route.ts",
      `import { db } from "@/db"; export async function GET() { return Response.json(await db.query("x")); }`,
    ),
    file(
      "app/api/write/route.ts",
      `import { db } from "@/db"; export async function POST() { await db.insert("x", {}); return Response.json({}); }`,
    ),
  ];
  const out = analyzeNextjsRoutes(files);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.severity, "medium");
  assert.equal(out[1]!.severity, "low");
});
