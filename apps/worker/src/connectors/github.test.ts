// Wire-format guards for the GitHub connector. We don't have a real GitHub
// sandbox in CI, so this file pins the SHAPE of the requests that
// openFixPr / openFileCreationPr make — the fields and their values are
// part of the public contract with GitHub (see issue #47: "always draft",
// branch must be kelp-namespaced, etc.). If a future refactor drops one
// of these, this test catches it before we ship.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const connectorSrc = readFileSync(join(here, "github.ts"), "utf8");

test("openFixPr POSTs to /pulls with draft: true (issue #47: never auto-merge)", () => {
  // Find the openFixPr block by anchoring on its unique return.
  const start = connectorSrc.indexOf("async openFixPr(");
  const end = connectorSrc.indexOf("return { url: pr.html_url, alreadyExisted: false };", start);
  assert.ok(start > 0, "openFixPr block not found");
  assert.ok(end > 0, "openFixPr return sentinel not found");
  const block = connectorSrc.slice(start, end);
  assert.match(
    block,
    /POST \/repos\/\{owner\}\/\{repo\}\/pulls[\s\S]*?draft:\s*true/,
    "openFixPr must pass draft: true to POST /pulls (#47)",
  );
});

test("openFileCreationPr POSTs to /pulls with draft: true (issue #47: never auto-merge)", () => {
  const start = connectorSrc.indexOf("async openFileCreationPr(");
  const end = connectorSrc.indexOf(`return { status: "opened", url: pr.html_url };`, start);
  assert.ok(start > 0, "openFileCreationPr block not found");
  assert.ok(end > 0, "openFileCreationPr return sentinel not found");
  const block = connectorSrc.slice(start, end);
  assert.match(
    block,
    /POST \/repos\/\{owner\}\/\{repo\}\/pulls[\s\S]*?draft:\s*true/,
    "openFileCreationPr must pass draft: true to POST /pulls (#47)",
  );
});

test("openFixPr enforces the kelp/ branch namespace (defense in depth)", () => {
  // The spec says every fix branch is kelp/*. The connector must reject
  // anything else, so a future caller passing "main" or "develop" is
  // caught before it touches the default branch.
  const start = connectorSrc.indexOf("async openFixPr(");
  const end = connectorSrc.indexOf("return { url: pr.html_url, alreadyExisted: false };", start);
  const block = connectorSrc.slice(start, end);
  assert.match(
    block,
    /input\.branch\.startsWith\("kelp\/"\)/,
    "openFixPr must check that branch starts with kelp/",
  );
  assert.match(
    block,
    /fix branch must be kelp-namespaced/,
    "openFixPr must throw a clear error when branch is not kelp-namespaced",
  );
});

test("openFileCreationPr also enforces the kelp/ branch namespace", () => {
  const start = connectorSrc.indexOf("async openFileCreationPr(");
  const end = connectorSrc.indexOf(`return { status: "opened", url: pr.html_url };`, start);
  const block = connectorSrc.slice(start, end);
  assert.match(
    block,
    /input\.branch\.startsWith\("kelp\/"\)/,
    "openFileCreationPr must check that branch starts with kelp/",
  );
});