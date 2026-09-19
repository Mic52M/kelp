// Guards the single color decision (ui/style.ts) and the issue #68 checklist:
// NO_COLOR, --no-color, piped stdout, and --json must all stay ANSI-free.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { colorEnabled, paint, BOLD } from "../src/ui/style.js";

const CLI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI_ENTRY = path.join(CLI_DIR, "src", "index.ts");
const ANSI = /\x1b\[/;

let fixture: string;
let configHome: string;

beforeEach(async () => {
  fixture = await fs.mkdtemp(path.join(os.tmpdir(), "kelp-color-"));
  configHome = await fs.mkdtemp(path.join(os.tmpdir(), "kelp-color-home-"));
  await fs.mkdir(path.join(fixture, "src"), { recursive: true });
  await fs.writeFile(path.join(fixture, "src", "app.ts"), "export const answer = 42;\n");
});

afterEach(async () => {
  await fs.rm(fixture, { recursive: true, force: true });
  await fs.rm(configHome, { recursive: true, force: true });
});

/** Spawn the CLI with a clean env: no ambient API key, no user kelp config. */
function run(args: string[], overrides: Record<string, string> = {}) {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.NO_COLOR;
  env.XDG_CONFIG_HOME = configHome;
  Object.assign(env, overrides);
  return spawnSync(process.execPath, ["--import", "tsx", CLI_ENTRY, ...args], {
    cwd: CLI_DIR,
    env,
    encoding: "utf8",
  });
}

describe("colorEnabled", () => {
  it("turns color on for an interactive, non-opted-out stdout", () => {
    assert.equal(colorEnabled({ env: {}, isTty: true }), true);
  });

  it("keeps color off when stdout is not a TTY", () => {
    assert.equal(colorEnabled({ env: {}, isTty: false }), false);
  });

  it("keeps color off when NO_COLOR is set to any non-empty value", () => {
    assert.equal(colorEnabled({ env: { NO_COLOR: "1" }, isTty: true }), false);
    assert.equal(colorEnabled({ env: { NO_COLOR: "0" }, isTty: true }), false);
  });

  it('treats NO_COLOR="" as unset, per the spec', () => {
    assert.equal(colorEnabled({ env: { NO_COLOR: "" }, isTty: true }), true);
  });

  it("keeps color off when --no-color is passed", () => {
    assert.equal(colorEnabled({ noColorFlag: true, env: {}, isTty: true }), false);
  });

  it("lets --no-color win over a set NO_COLOR", () => {
    assert.equal(colorEnabled({ noColorFlag: true, env: { NO_COLOR: "1" }, isTty: true }), false);
  });
});

describe("paint gating", () => {
  it("emits escapes only while the decision allows color", () => {
    // Positive control: the spawn-based cases below would pass vacuously if
    // paint never emitted ANSI, so force a TTY here.
    const ttyDesc = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    const savedNoColor = process.env.NO_COLOR;
    delete process.env.NO_COLOR;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    try {
      assert.match(paint("x", BOLD), ANSI);
    } finally {
      if (ttyDesc) Object.defineProperty(process.stdout, "isTTY", ttyDesc);
      else delete (process.stdout as { isTTY?: boolean }).isTTY;
      if (savedNoColor !== undefined) process.env.NO_COLOR = savedNoColor;
    }
    assert.equal(paint("x", BOLD), "x");
  });
});

describe("kelp scan stays ANSI-free (issue #68 checklist)", () => {
  it("NO_COLOR=1 strips every escape", () => {
    const r = run(["scan", fixture], { NO_COLOR: "1" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /TARGET/);
    assert.doesNotMatch(r.stdout, ANSI);
  });

  it("--no-color strips every escape", () => {
    const r = run(["scan", fixture, "--no-color"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /TARGET/);
    assert.doesNotMatch(r.stdout, ANSI);
  });

  it("piped stdout strips every escape (spawn pipes stdout)", () => {
    const r = run(["scan", fixture]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /TARGET/);
    assert.doesNotMatch(r.stdout, ANSI);
  });

  it("--json stays ANSI-free and parseable", () => {
    const r = run(["scan", fixture, "--json"]);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, ANSI);
    const parsed = JSON.parse(r.stdout) as { filesScanned: number };
    assert.ok(parsed.filesScanned >= 1);
  });
});
