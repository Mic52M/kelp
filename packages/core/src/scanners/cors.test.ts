// cors scanner tests. VULN/CONTROL for each of the three tiers.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SourceFile } from "./secrets.js";
import { analyzeCors } from "./cors.js";

function file(path: string, content: string): SourceFile {
  return { path, content };
}

test("VULN: reflected Origin + credentials is critical", () => {
  const f = file(
    "app/api/data/route.ts",
    `export function GET(req) {
       return new Response(body, { headers: {
         "Access-Control-Allow-Origin": req.headers.get("origin"),
         "Access-Control-Allow-Credentials": "true",
       }});
     }`,
  );
  const out = analyzeCors([f]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.issue, "cors_reflect_credentials");
  assert.equal(out[0]!.severity, "critical");
});

test("VULN: wildcard + credentials is high", () => {
  const f = file(
    "supabase/functions/api/index.ts",
    `const cors = {
       "Access-Control-Allow-Origin": "*",
       "Access-Control-Allow-Credentials": "true",
     };`,
  );
  const out = analyzeCors([f]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.issue, "cors_wildcard_credentials");
  assert.equal(out[0]!.severity, "high");
});

test("VULN: wildcard without credentials is medium", () => {
  const f = file(
    "app/api/public/route.ts",
    `const headers = { "Access-Control-Allow-Origin": "*" };`,
  );
  const out = analyzeCors([f]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.issue, "cors_wildcard");
  assert.equal(out[0]!.severity, "medium");
});

test("VULN: setHeader form (comma-separated) is detected", () => {
  const f = file(
    "pages/api/x.ts",
    `res.setHeader("Access-Control-Allow-Origin", "*");`,
  );
  assert.equal(analyzeCors([f]).length, 1);
});

test("CONTROL: a hardcoded allowlisted origin is not flagged", () => {
  const f = file(
    "app/api/data/route.ts",
    `const headers = {
       "Access-Control-Allow-Origin": "https://app.kelp.build",
       "Access-Control-Allow-Credentials": "true",
     };`,
  );
  assert.equal(analyzeCors([f]).length, 0);
});

test("CONTROL: reflected Origin WITHOUT credentials is not flagged", () => {
  const f = file(
    "app/api/data/route.ts",
    `const headers = { "Access-Control-Allow-Origin": req.headers.get("origin") };`,
  );
  assert.equal(
    analyzeCors([f]).length,
    0,
    "reflection without credentials only leaks public data; low signal",
  );
});

test("findings are severity-ordered with stable, unique fingerprints", () => {
  const files = [
    file("a.ts", `const h = { "Access-Control-Allow-Origin": "*" };`),
    file(
      "b.ts",
      `const h = { "Access-Control-Allow-Origin": req.headers.get("origin"), "Access-Control-Allow-Credentials": "true" };`,
    ),
  ];
  const out = analyzeCors(files);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.severity, "critical"); // reflect+creds before wildcard
  assert.equal(out[1]!.severity, "medium");
  assert.equal(new Set(out.map((x) => x.fingerprint)).size, 2);
});
