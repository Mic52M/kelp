import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { walk } from "../src/walk.js";

let tmp: string;

async function write(rel: string, content = "x"): Promise<void> {
  const full = path.join(tmp, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
}

/** Walk and return sorted paths relative to the fixture root. */
async function walked(opts?: { gitignore?: boolean }): Promise<string[]> {
  const abs = await walk(tmp, opts);
  return abs.map((p) => path.relative(tmp, p)).sort();
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "kelp-walk-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("walk .gitignore support", () => {
  it("skips files ignored by the root .gitignore", async () => {
    await write(".gitignore", "*.log\nignored.txt\nbuild-output/\n");
    await write("ignored.txt");
    await write("debug.log");
    await write("kept.txt");
    await write("build-output/bundle.js");
    await write("src/app.js");

    const got = await walked();
    assert.ok(!got.includes("ignored.txt"), "ignored.txt should be skipped");
    assert.ok(!got.includes("debug.log"), "*.log should be skipped");
    assert.ok(
      !got.includes(path.join("build-output", "bundle.js")),
      "ignored dir contents should be skipped",
    );
    assert.ok(got.includes("kept.txt"), "kept.txt should be walked");
    assert.ok(
      got.includes(path.join("src", "app.js")),
      "src/app.js should be walked",
    );
    assert.ok(
      !got.includes(".gitignore"),
      ".gitignore itself should not be walked",
    );
  });

  it("honors nested .gitignore files plus root patterns at depth", async () => {
    await write(".gitignore", "*.log\n");
    await write("packages/a/.gitignore", "local.txt\n");
    await write("packages/a/local.txt");
    await write("packages/a/keep.txt");
    await write("packages/a/debug.log");

    const got = await walked();
    assert.ok(
      !got.includes(path.join("packages", "a", "local.txt")),
      "nested .gitignore should skip local.txt",
    );
    assert.ok(
      got.includes(path.join("packages", "a", "keep.txt")),
      "packages/a/keep.txt should be walked",
    );
    assert.ok(
      !got.includes(path.join("packages", "a", "debug.log")),
      "root *.log should apply at depth",
    );
  });

  it("still picks up .env unless it is ignored", async () => {
    await write(".gitignore", "ignored.txt\n");
    await write("ignored.txt");
    await write(".env", "SECRET=1");
    await write(".env.local", "SECRET=2");

    let got = await walked();
    assert.ok(got.includes(".env"), ".env should be walked when not ignored");
    assert.ok(
      got.includes(".env.local"),
      ".env.local should be walked when not ignored",
    );

    await write(".gitignore", "ignored.txt\n.env\n");
    got = await walked();
    assert.ok(!got.includes(".env"), ".env should be skipped when ignored");
    assert.ok(
      got.includes(".env.local"),
      ".env.local should still be walked",
    );
  });

  it("supports negation (!pattern) re-including an ignored file", async () => {
    await write(".gitignore", "*.log\n!important.log\n");
    await write("debug.log");
    await write("important.log");

    const got = await walked();
    assert.ok(!got.includes("debug.log"), "debug.log should be skipped");
    assert.ok(
      got.includes("important.log"),
      "negated important.log should be walked",
    );
  });

  it("walks ignored files when gitignore is disabled", async () => {
    await write(".gitignore", "ignored.txt\n");
    await write("ignored.txt");
    await write("kept.txt");

    const got = await walked({ gitignore: false });
    assert.ok(
      got.includes("ignored.txt"),
      "ignored.txt should be walked with gitignore off",
    );
    assert.ok(got.includes("kept.txt"), "kept.txt should be walked");
  });

  it("keeps the static skip-list (node_modules)", async () => {
    await write("node_modules/pkg/index.js");
    await write("src/app.js");

    const got = await walked();
    assert.ok(
      !got.includes(path.join("node_modules", "pkg", "index.js")),
      "node_modules should be skipped",
    );
    assert.ok(
      got.includes(path.join("src", "app.js")),
      "src/app.js should be walked",
    );
  });
});
