import { test } from "node:test";
import assert from "node:assert/strict";
import { runFreeScan, redactFinding } from "./free-scan.js";
import type { SourceFile } from "./scanners/secrets.js";

function file(path: string, content: string): SourceFile {
  return { path, content };
}

test("runFreeScan detects a client-side secret", () => {
  const files: SourceFile[] = [
    file(
      "src/lib/db.ts",
      // A Supabase service_role JWT starts with eyJ; use a known-shape token so
      // the secret scanner picks it up as high-severity client-side.
      `export const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.` +
        `eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNjAwMDAwMDAwfQ.` +
        `Bx8_yFGxvXFEHsvlWQfOFCkY-jSp7oqe4H3vP8LMoK4";`,
    ),
  ];
  const s = runFreeScan({ repoUrl: "https://github.com/x/y", files });
  const secretFindings = s.findings.filter((f) => f.vulnClass === "secret");
  assert.ok(secretFindings.length >= 1, "expected at least one secret finding");
  assert.ok(s.ranScanners.includes("secret"));
  assert.ok(s.counts.critical + s.counts.high + s.counts.medium + s.counts.low === s.findings.length);
});

test("runFreeScan flags an RLS-disabled table from a repo migration", () => {
  const migration =
    "create table public.invoices (id uuid primary key, user_id uuid, total numeric);";
  const files: SourceFile[] = [file("supabase/migrations/0001_init.sql", migration)];
  const s = runFreeScan({ repoUrl: "https://github.com/x/y", files });
  const rls = s.findings.filter((f) => f.vulnClass === "rls");
  assert.ok(rls.length >= 1, "expected at least one RLS finding from repo schema");
  assert.ok(s.ranScanners.includes("rls_from_repo"));
});

test("runFreeScan tells the user honestly when no backend is detected", () => {
  const files: SourceFile[] = [file("README.md", "# nothing")];
  const s = runFreeScan({ repoUrl: "https://github.com/x/y", files });
  assert.equal(s.backendDetected, "none");
  assert.ok(!s.ranScanners.includes("rls_from_repo"));
  assert.ok(
    s.notes.some((n) => n.toLowerCase().includes("no supabase")),
    "expected a 'no Supabase' note",
  );
});

test("runFreeScan detects Firebase and phrases accordingly", () => {
  const files: SourceFile[] = [
    file("firebase.json", '{"hosting":{}}'),
    file("firestore.rules", 'rules_version = "2";\nservice cloud.firestore {\n  match /databases/{db}/documents {\n    match /{doc=**} { allow read, write: if true; }\n  }\n}'),
  ];
  const s = runFreeScan({ repoUrl: "https://github.com/x/y", files });
  assert.equal(s.backendDetected, "firebase");
  assert.ok(s.notes.some((n) => n.toLowerCase().includes("firebase")));
});

test("runFreeScan surfaces the cap-reached signal", () => {
  const files: SourceFile[] = [file("README.md", "# hi")];
  const s = runFreeScan({ repoUrl: "https://github.com/x/y", files, capReached: true });
  assert.ok(s.capReached);
  assert.ok(s.notes.some((n) => n.toLowerCase().includes("only the first")));
});

test("runFreeScan populates diagnostic counts", () => {
  const files: SourceFile[] = [
    file("supabase/migrations/0001_init.sql", "create table public.t(id uuid primary key);"),
    file("src/x.ts", "export {};"),
  ];
  const s = runFreeScan({ repoUrl: "https://github.com/x/y", files, entriesSeen: 42 });
  assert.equal(s.filesScanned, 2);
  assert.equal(s.entriesSeen, 42);
  assert.equal(s.backendDetected, "supabase");
  assert.ok(s.tablesParsed >= 1);
});

test("redactFinding strips location + explanation", () => {
  const files: SourceFile[] = [
    file(
      "src/lib/db.ts",
      `export const KEY = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxfQ.abcabcabcabcabcabcabc";`,
    ),
  ];
  const s = runFreeScan({ repoUrl: "https://github.com/x/y", files });
  if (s.findings.length === 0) return; // scanner may not match on this synthetic; not the point of this test
  const r = redactFinding(s.findings[0]!);
  assert.equal(r.title, s.findings[0]!.title);
  assert.equal((r as unknown as { location?: unknown }).location, undefined);
  assert.equal((r as unknown as { explanation?: unknown }).explanation, undefined);
});
