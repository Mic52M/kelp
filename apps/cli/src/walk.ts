// Directory walker used by the scan command. Skips the well-known noise dirs
// (node_modules, .git, dist, build, .next, vendor, __pycache__) up front so we
// don't waste stat calls on them. Everything else is offered to the scanner;
// the scanner's own `shouldScanPath` in @kelp/core is the second gate.

import fs from "node:fs/promises";
import path from "node:path";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  "vendor",
  "__pycache__",
  ".venv",
  "target",
  "coverage",
]);

/** Recursively walk a directory, returning absolute file paths. */
export async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  await walkInto(root, out);
  return out;
}

async function walkInto(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    // Unreadable directory — skip silently. Not a failure of the whole scan.
    return;
  }
  for (const e of entries) {
    // Skip dotfiles / dotdirs — with the exception of `.env*`, which the
    // scanner explicitly wants to see (`.env.example` alone is skipped
    // downstream by shouldScanPath).
    if (e.name.startsWith(".") && !/^\.env(\.|$)/.test(e.name)) continue;

    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      await walkInto(full, out);
    } else if (e.isFile()) {
      out.push(full);
    }
  }
}
