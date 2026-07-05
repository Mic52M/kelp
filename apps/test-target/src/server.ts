// ⚠️  Deliberately-vulnerable test target for Kelp's pen-testing specialists.
//
//     DO NOT DEPLOY ANYWHERE THAT ISN'T localhost.
//
// This is the ground-truth app Kelp's specialists probe against so we can
// verify — deterministically — that:
//   1) each specialist finds the flaw we planted for its class, and
//   2) no specialist raises a false positive against a properly-secured
//      endpoint.
//
// Endpoints are grouped by intent:
//   /api/login              — issue a session token for test account A or B
//   /api/orders/:id         — BOLA-VULNERABLE (returns any order by id, no
//                              ownership check)
//   /api/profiles/:id       — SECURE control (checks ownership before
//                              returning)
//   /api/me                 — auth surface (echoes the session's user)
//   /api/session-lookup     — AUTH-BYPASS-VULNERABLE (accepts a naive
//                              "?as=userB" query param that swaps the caller
//                              — models a common weak-session bug)
//
// Reads are always in-memory; there is no DB. The point is not to be
// production-realistic — it's to be *observably* vulnerable in a way a
// specialist agent can confirm through a probe.

import express, { type Request, type Response } from "express";
import crypto from "node:crypto";

// ─── Seed data ────────────────────────────────────────────────────────────────

interface User {
  id: string;
  email: string;
  password: string; // plaintext for the mock — this is not real
}

interface Order {
  id: string;
  ownerId: string;
  amount: number;
  memo: string;
}

interface Profile {
  id: string;
  ownerId: string;
  displayName: string;
}

const users: User[] = [
  { id: "userA", email: "a@test.local", password: "secretA" },
  { id: "userB", email: "b@test.local", password: "secretB" },
];

const orders: Order[] = [
  { id: "ord_1001", ownerId: "userA", amount: 1200, memo: "A's order" },
  { id: "ord_1002", ownerId: "userA", amount: 3400, memo: "A's other order" },
  { id: "ord_2001", ownerId: "userB", amount: 5600, memo: "B's order" },
  { id: "ord_2002", ownerId: "userB", amount: 7800, memo: "B's other order" },
];

const profiles: Profile[] = [
  { id: "prf_a", ownerId: "userA", displayName: "Alice" },
  { id: "prf_b", ownerId: "userB", displayName: "Bob" },
];

// ─── Session tokens (deliberately naive) ──────────────────────────────────────
//
// Weak on purpose: a base64 of "userId.expires" signed with a hard-coded key.
// A specialist looking for weak crypto or session forgery would flag this;
// for BOLA testing we treat it as trusted state.

const SESSION_KEY = "kelp-test-target-DEV-ONLY-do-not-copy";

function issueToken(userId: string): string {
  const payload = `${userId}.${Date.now() + 3600_000}`;
  const sig = crypto.createHmac("sha256", SESSION_KEY).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

function verifyToken(token: string | undefined): string | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const payload = Buffer.from(body, "base64url").toString("utf8");
  const expected = crypto.createHmac("sha256", SESSION_KEY).update(payload).digest("base64url");
  if (sig !== expected) return null;
  const [userId, expiryStr] = payload.split(".");
  if (!userId || !expiryStr) return null;
  if (Date.now() > Number(expiryStr)) return null;
  return userId;
}

function currentUser(req: Request): string | null {
  const header = req.header("authorization") ?? "";
  const [, token] = header.split(" ");
  return verifyToken(token);
}

// ─── App ──────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, target: "kelp-test-target" });
});

// POST /api/login — normal login, issues a token for the matching user.
app.post("/api/login", (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};
  const user = users.find((u) => u.email === email && u.password === password);
  if (!user) {
    res.status(401).json({ error: "invalid credentials" });
    return;
  }
  res.json({ userId: user.id, token: issueToken(user.id) });
});

// GET /api/me — echoes the authenticated user.
app.get("/api/me", (req: Request, res: Response) => {
  const userId = currentUser(req);
  if (!userId) {
    res.status(401).json({ error: "not authenticated" });
    return;
  }
  const user = users.find((u) => u.id === userId);
  res.json({ userId, email: user?.email });
});

// ─── VULNERABLE: naive "SQL-like" search on /api/orders/search ────────────────
// Registered BEFORE /api/orders/:id so Express matches this specific route
// first; otherwise "search" would be captured as an :id value.
app.get("/api/orders/search", (req: Request, res: Response) => {
  const userId = currentUser(req);
  if (!userId) {
    res.status(401).json({ error: "not authenticated" });
    return;
  }
  const q = String(req.query.q ?? "");
  const isInjection =
    /(?:'\s*OR\s*'1'\s*=\s*'1|OR\s+1\s*=\s*1|UNION\s+SELECT|;\s*DROP\b|--\s*$)/i.test(q);
  const results = isInjection
    ? orders // BYPASS: caller-controlled payload widens the WHERE → all rows
    : orders.filter(
        (o) => o.ownerId === userId && o.memo.toLowerCase().includes(q.toLowerCase()),
      );
  res.json({ q, count: results.length, results });
});

// ─── SECURE control: /api/orders/find uses a parameterised filter ─────────────
// Also registered before /:id so it's actually reachable.
app.get("/api/orders/find", (req: Request, res: Response) => {
  const userId = currentUser(req);
  if (!userId) {
    res.status(401).json({ error: "not authenticated" });
    return;
  }
  const q = String(req.query.q ?? "").toLowerCase();
  const results = orders.filter(
    (o) => o.ownerId === userId && o.memo.toLowerCase().includes(q),
  );
  res.json({ q, count: results.length, results });
});

// ─── VULNERABLE: BOLA on /api/orders/:id ──────────────────────────────────────
// Missing ownership check — anyone authenticated can read any order.
app.get("/api/orders/:id", (req: Request, res: Response) => {
  const userId = currentUser(req);
  if (!userId) {
    res.status(401).json({ error: "not authenticated" });
    return;
  }
  const order = orders.find((o) => o.id === req.params.id);
  if (!order) {
    res.status(404).json({ error: "order not found" });
    return;
  }
  // BOLA: no `order.ownerId === userId` check → cross-account read succeeds.
  res.json(order);
});

// ─── SECURE control: /api/profiles/:id enforces ownership ─────────────────────
app.get("/api/profiles/:id", (req: Request, res: Response) => {
  const userId = currentUser(req);
  if (!userId) {
    res.status(401).json({ error: "not authenticated" });
    return;
  }
  const profile = profiles.find((p) => p.id === req.params.id);
  if (!profile) {
    res.status(404).json({ error: "profile not found" });
    return;
  }
  if (profile.ownerId !== userId) {
    // Correct behavior: refuse cross-account reads.
    res.status(403).json({ error: "forbidden" });
    return;
  }
  res.json(profile);
});

// ─── VULNERABLE: naive auth-bypass on /api/session-lookup ─────────────────────
// The endpoint accepts an "?as=" query param that forces the caller identity —
// classic mistake, sometimes seen in debug endpoints left in production.
app.get("/api/session-lookup", (req: Request, res: Response) => {
  const impersonate = typeof req.query.as === "string" ? req.query.as : null;
  const effective = impersonate ?? currentUser(req);
  if (!effective) {
    res.status(401).json({ error: "not authenticated" });
    return;
  }
  const owned = orders.filter((o) => o.ownerId === effective);
  res.json({ effectiveUserId: effective, orders: owned });
});

// ─── VULNERABLE: SSRF on /api/fetch?url=… ─────────────────────────────────────
// Models the classic "fetch this URL server-side for me" endpoint that many
// vibe-coded apps ship (avatar mirror, webhook forwarder, "import from URL").
// This one fetches ANY URL the caller supplies — perfect ground truth for the
// SSRF specialist. Returns only the response status + byte length so we don't
// leak third-party bodies into the specialist's transcript.
app.get("/api/fetch", async (req: Request, res: Response) => {
  const userId = currentUser(req);
  if (!userId) {
    res.status(401).json({ error: "not authenticated" });
    return;
  }
  const url = String(req.query.url ?? "");
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
    const buf = await r.arrayBuffer();
    res.json({ status: r.status, length: buf.byteLength });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── SECURE control: /api/fetch-safe with a host allowlist ────────────────────
// Same shape (fetch a URL) but only allowed for a hard-coded host — any other
// host, including any loopback / RFC1918 / metadata-IP payload, is rejected
// with 403 before any request goes out. The SSRF specialist must NOT flag this.
const FETCH_ALLOWLIST = new Set(["example.com"]);
app.get("/api/fetch-safe", async (req: Request, res: Response) => {
  const userId = currentUser(req);
  if (!userId) {
    res.status(401).json({ error: "not authenticated" });
    return;
  }
  const url = String(req.query.url ?? "");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    res.status(400).json({ error: "malformed url" });
    return;
  }
  if (!FETCH_ALLOWLIST.has(parsed.host)) {
    res.status(403).json({ error: "host not on allowlist" });
    return;
  }
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
    const buf = await r.arrayBuffer();
    res.json({ status: r.status, length: buf.byteLength });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 4400);
if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen(PORT, () => {
    console.log(`kelp-test-target listening on http://localhost:${PORT}`);
    console.log(`  seeded users: ${users.map((u) => u.email).join(", ")}`);
    console.log(`  BOLA-vulnerable endpoint: GET /api/orders/:id`);
    console.log(`  SECURE control endpoint:  GET /api/profiles/:id`);
    console.log(`  AUTH-BYPASS endpoint:     GET /api/session-lookup?as=<userId>`);
    console.log(`  INJECTION-vulnerable:     GET /api/orders/search?q=<payload>`);
    console.log(`  INJECTION-safe control:   GET /api/orders/find?q=<text>`);
    console.log(`  SSRF-vulnerable:          GET /api/fetch?url=<any-url>`);
    console.log(`  SSRF-safe control:        GET /api/fetch-safe?url=<allowlisted-host>`);
  });
}

export { app };
