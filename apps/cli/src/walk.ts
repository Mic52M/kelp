// Directory walker used by the scan command. Skips the well-known noise dirs
// (node_modules, .git, dist, build, .next, vendor, __pycache__) up front so we
// don't waste stat calls on them, then honors `.gitignore` files (root and
// nested) so ignored files never reach the scanner. Everything else is
// offered to the scanner; the scanner's own `shouldScanPath` in @kelp/core
// is the second gate.

import fs from "node:fs/promises";
import path from "node:path";
import ignore from "ignore";

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

export interface WalkOptions {
  /**
   * Honor `.gitignore` files found in the walked tree. Defaults to `true`.
   * Set to `false` to walk everything (modulo `SKIP_DIRS` + dotfiles).
   */
  gitignore?: boolean;
}

/** One `.gitignore` scope: the dir it lives in plus its parsed rules. */
interface GitignoreScope {
  dir: string;
  ig: ignore.Ignore;
}

/** Recursively walk a directory, returning absolute file paths. */
export async function walk(root: string, opts?: WalkOptions): Promise<string[]> {
  const out: string[] = [];
  const useGitignore = opts?.gitignore !== false;
  await walkInto(root, out, [], useGitignore);
  return out;
}

async function walkInto(
  dir: string,
  out: string[],
  parentScopes: readonly GitignoreScope[],
  useGitignore: boolean,
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    // Unreadable directory — skip silently. Not a failure of the whole scan.
    return;
  }

  // A `.gitignore` in this dir applies to everything under it, on top of
  // (and able to re-include files ignored by) shallower scopes.
  let scopes = parentScopes;
  if (useGitignore) {
    const ig = await loadGitignore(dir);
    if (ig) scopes = [...parentScopes, { dir, ig }];
  }

  for (const e of entries) {
    // Skip dotfiles / dotdirs — with the exception of `.env*`, which the
    // scanner explicitly wants to see (`.env.example` alone is skipped
    // downstream by shouldScanPath). Note the `.gitignore` itself is read
    // via loadGitignore above, not via this loop, so skipping it here
    // only keeps it out of the results.
    if (e.name.startsWith(".") && !/^\.env(\.|$)/.test(e.name)) continue;

    const full = path.join(dir, e.name);
    const isDir = e.isDirectory();
    if (isIgnored(scopes, full, isDir)) continue;
    if (isDir) {
      if (SKIP_DIRS.has(e.name)) continue;
      await walkInto(full, out, scopes, useGitignore);
    } else if (e.isFile()) {
      out.push(full);
    }
  }
}

/** Read + parse `<dir>/.gitignore`. Returns null when absent/unreadable. */
async function loadGitignore(dir: string): Promise<ignore.Ignore | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dir, ".gitignore"), "utf8");
  } catch {
    return null;
  }
  if (!raw.trim()) return null;
  const ig: ignore.Ignore = ignore();
  return ig.add(raw);
}

/**
 * Test `full` against every applicable scope, shallowest first. A deeper
 * `.gitignore` can re-include (`!pattern`) what a shallower one ignored,
 * matching git semantics.
 */
function isIgnored(
  scopes: readonly GitignoreScope[],
  full: string,
  isDir: boolean,
): boolean {
  let ignored = false;
  for (const { dir, ig } of scopes) {
    let rel = path.relative(dir, full);
    if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`)) continue;
    // `ignore` expects posix-style relative paths, and determines
    // "is a directory" from a trailing slash — without it, dir-only
    // patterns like `build/` never match.
    rel = rel.split(path.sep).join("/");
    const res = ig.test(isDir ? `${rel}/` : rel);
    if (res.ignored) ignored = true;
    else if (res.unignored) ignored = false;
  }
  return ignored;
}
