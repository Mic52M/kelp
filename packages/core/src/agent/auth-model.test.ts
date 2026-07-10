import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthModelBrief,
  buildAuthModelNarrative,
  checkExploitability,
  detectCookieSessions,
  detectCorsAllowCredentials,
  detectCorsWhitelistedOrigins,
  detectOneTimeTokenTables,
  detectServerSidePriceRecalc,
} from "./auth-model.js";
import type { SourceFile } from "../scanners/secrets.js";

function file(path: string, content: string): SourceFile {
  return { path, content };
}

// ─── Static detectors ───────────────────────────────────────────────────────

test("detectCookieSessions catches Set-Cookie in various forms", () => {
  assert.equal(detectCookieSessions([file("a.ts", "Response({headers: { 'Set-Cookie': 'x=y' }})")]), true);
  assert.equal(detectCookieSessions([file("b.ts", "res.cookie('name', 'v')")]), true);
  assert.equal(detectCookieSessions([file("c.ts", "headers.set('Set-Cookie', 'a=b')")]), true);
  assert.equal(detectCookieSessions([file("d.ts", "// no cookies here")]), false);
});

test("detectCorsAllowCredentials matches both TS literals and header sets", () => {
  assert.equal(detectCorsAllowCredentials([file("a.ts", '"Access-Control-Allow-Credentials": "true"')]), true);
  assert.equal(detectCorsAllowCredentials([file("b.ts", 'headers.set("Access-Control-Allow-Credentials", "true")')]), true);
  assert.equal(detectCorsAllowCredentials([file("c.ts", 'Allow-Credentials: false')]), false);
  assert.equal(detectCorsAllowCredentials([]), false);
});

test("detectCorsWhitelistedOrigins extracts explicit origins, ignores *", () => {
  const files = [
    file("cors.ts", '"Access-Control-Allow-Origin": "https://example.com"'),
    file("wildcard.ts", '"Access-Control-Allow-Origin": "*"'),
    file("two.ts", '"Access-Control-Allow-Origin": "https://foo.dev"'),
  ];
  const origins = detectCorsWhitelistedOrigins(files);
  assert.deepEqual(origins, ["https://example.com", "https://foo.dev"]);
});

test("detectServerSidePriceRecalc picks up products-table lookups in order endpoints", () => {
  const files = [
    file(
      "supabase/functions/place-order/index.ts",
      "const { data } = await admin.from('products').select('id, price, unit_price');",
    ),
    file("supabase/functions/health/index.ts", "return new Response('ok');"),
  ];
  const hits = detectServerSidePriceRecalc(files);
  assert.equal(hits.length, 1);
  assert.ok(hits[0]!.endsWith("place-order/index.ts"));
});

test("detectOneTimeTokenTables catches token tables with validation nearby", () => {
  const files = [
    file(
      "supabase/functions/unsubscribe/index.ts",
      "await admin.from('email_unsubscribe_tokens').select('*').eq('used_at', null)",
    ),
    file(
      "supabase/functions/magic/index.ts",
      "const token = crypto.randomUUID(); await admin.from('magic_tokens').insert({token})",
    ),
  ];
  const tables = detectOneTimeTokenTables(files);
  assert.ok(tables.includes("email_unsubscribe_tokens"));
  assert.ok(tables.includes("magic_tokens"));
});

// ─── buildAuthModelBrief ────────────────────────────────────────────────────

test("buildAuthModelBrief classifies bearer-JWT (no cookies) apps correctly", () => {
  const brief = buildAuthModelBrief([
    file("cors.ts", 'headers.set("Access-Control-Allow-Origin", "*")'),
    file("app.ts", "const jwt = req.headers.get('Authorization')"),
  ]);
  assert.equal(brief.primaryAuthMode, "bearer_jwt");
  assert.equal(brief.hasCookieSessions, false);
  assert.equal(brief.corsAllowsCredentials, false);
  assert.ok(brief.narrative.includes("BEARER JWT"));
  assert.ok(brief.narrative.includes("Do NOT file CSRF findings"));
});

test("buildAuthModelBrief classifies cookie-session apps correctly", () => {
  const brief = buildAuthModelBrief([
    file("login.ts", 'return new Response(null, { headers: { "Set-Cookie": "session=xyz" } })'),
    file("cors.ts", '"Access-Control-Allow-Credentials": "true"'),
  ]);
  assert.equal(brief.primaryAuthMode, "mixed");
  assert.equal(brief.hasCookieSessions, true);
  assert.equal(brief.corsAllowsCredentials, true);
  assert.ok(/session cookies/i.test(brief.narrative));
});

test("buildAuthModelBrief classifies pure cookie apps when no Allow-Credentials found", () => {
  const brief = buildAuthModelBrief([
    file("login.ts", 'return new Response(null, { headers: { "Set-Cookie": "session=xyz" } })'),
  ]);
  assert.equal(brief.primaryAuthMode, "cookie_session");
  assert.equal(brief.hasCookieSessions, true);
});

// ─── checkExploitability — the anti-false-positive gate ─────────────────────

const bearerJwtModel = buildAuthModelBrief([
  file("app.ts", 'headers.set("Access-Control-Allow-Origin", "*")'),
]);

const cookieAppModel = buildAuthModelBrief([
  file("login.ts", '"Set-Cookie": "session=x"'),
  file("cors.ts", '"Access-Control-Allow-Credentials": "true"'),
]);

test("gate REJECTS CSRF findings on bearer-JWT apps (Lovable's #1 refutation)", () => {
  const reason = checkExploitability(
    {
      vulnClass: "auth",
      severity: "high",
      title: "CSRF in place-order endpoint",
      evidence: "The endpoint accepts POST from any origin with no CSRF token.",
    },
    bearerJwtModel,
  );
  assert.ok(reason);
  assert.match(reason!, /bearer JWT|ambient authority|cross-origin/i);
});

test("gate ALLOWS CSRF findings on cookie-session apps", () => {
  const reason = checkExploitability(
    {
      vulnClass: "auth",
      severity: "high",
      title: "CSRF in place-order endpoint",
      evidence: "Cookie sessions + no CSRF token — cross-site form can trigger order.",
    },
    cookieAppModel,
  );
  assert.equal(reason, null);
});

test("gate REJECTS wildcard-CORS medium+ findings without Allow-Credentials or sensitive body", () => {
  const reason = checkExploitability(
    {
      vulnClass: "exposure",
      severity: "medium",
      title: "Permissive CORS on get-user-roles",
      evidence: "The endpoint returns Access-Control-Allow-Origin: * and role data.",
    },
    bearerJwtModel,
  );
  assert.ok(reason);
  assert.match(reason!, /Allow-Credentials|credential|hardening/i);
});

test("gate ALLOWS wildcard-CORS findings when evidence names a sensitive body value", () => {
  const reason = checkExploitability(
    {
      vulnClass: "exposure",
      severity: "high",
      title: "Wildcard CORS leaks session token",
      evidence: "Response body contains the user's session_id in plaintext.",
    },
    bearerJwtModel,
  );
  assert.equal(reason, null);
});

test("gate ALLOWS wildcard-CORS findings at severity=low (hardening) regardless", () => {
  const reason = checkExploitability(
    {
      vulnClass: "exposure",
      severity: "low",
      title: "Permissive CORS headers",
      evidence: "Wildcard origin without credentials — hardening.",
    },
    bearerJwtModel,
  );
  assert.equal(reason, null);
});

test("gate REJECTS anon-INSERT findings without downstream-harm evidence", () => {
  const reason = checkExploitability(
    {
      vulnClass: "rls",
      severity: "medium",
      title: "Anonymous INSERT on newsletter_subscribers",
      evidence: "Anon can insert any email. Policy allows this.",
    },
    bearerJwtModel,
  );
  assert.ok(reason);
  assert.match(reason!, /downstream harm|publicly readable|webhook|enumeration/i);
});

test("gate ALLOWS anon-INSERT findings when evidence names concrete harm", () => {
  const reason = checkExploitability(
    {
      vulnClass: "rls",
      severity: "medium",
      title: "Anonymous INSERT on newsletter_subscribers",
      evidence:
        "Anon INSERT allows arbitrary email addresses — enables spam / enumeration of subscribers.",
    },
    bearerJwtModel,
  );
  assert.equal(reason, null);
});

test("gate PASSES ordinary RLS cross-account findings untouched", () => {
  const reason = checkExploitability(
    {
      vulnClass: "rls",
      severity: "high",
      title: "Cross-account read on private_notes",
      evidence: "AccountA read three rows owned by accountB by removing the RLS filter.",
    },
    bearerJwtModel,
  );
  assert.equal(reason, null);
});

// ─── Narrative content check ────────────────────────────────────────────────

test("narrative includes the impact-chain requirement", () => {
  const brief = buildAuthModelBrief([]);
  assert.ok(brief.narrative.includes("impact chain"));
  assert.ok(brief.narrative.includes("attacker"));
});

test("narrative names the specific facts (one-time tokens, price recalc)", () => {
  const brief = buildAuthModelBrief([
    file("place-order/index.ts", "await admin.from('products').select('price')"),
    file("unsub/index.ts", "await from('email_unsubscribe_tokens').select('used_at')"),
  ]);
  assert.ok(brief.narrative.includes("place-order"));
  assert.ok(brief.narrative.includes("email_unsubscribe_tokens"));
});

test("narrative is stable across calls (deterministic)", () => {
  const files = [file("a.ts", "// nothing interesting")];
  const a = buildAuthModelNarrative({
    primaryAuthMode: "bearer_jwt",
    hasCookieSessions: false,
    corsAllowsCredentials: false,
    corsWhitelistedOrigins: [],
    serverSidePriceRecalcHints: [],
    oneTimeTokenTables: [],
  });
  const b = buildAuthModelNarrative({
    primaryAuthMode: "bearer_jwt",
    hasCookieSessions: false,
    corsAllowsCredentials: false,
    corsWhitelistedOrigins: [],
    serverSidePriceRecalcHints: [],
    oneTimeTokenTables: [],
  });
  assert.equal(a, b);
  assert.ok(files.length >= 0); // silence unused
});
