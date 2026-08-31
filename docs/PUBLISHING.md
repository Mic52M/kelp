# Publishing

How to cut a new release + push `@kelp/cli` to npm. Not something contributors
usually touch — this is the maintainer's checklist.

## Cutting a new release

1. **Update the CHANGELOG.** Move the current `[Unreleased]` block to a new
   version block dated today. Keep `[Unreleased]` empty (`_Nothing yet._`).
2. **Bump versions** — semver:
   - Patch (0.2.0 → 0.2.1): bug fixes, doc updates.
   - Minor (0.2.0 → 0.3.0): new detections, new CLI flags, other additive
     features.
   - Major (0.2.0 → 1.0.0): only when a public API breaks (CLI flag removed
     or renamed, JSON output shape changed, `@kelp/core` export removed).
   - Places to bump:
     - `apps/cli/package.json` — `"version"`
     - `apps/cli/src/index.ts` — `const VERSION`
3. **Commit + push** the CHANGELOG + version bumps.
4. **Tag + push.**
   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z — one-line summary"
   git push origin vX.Y.Z
   ```
5. **Create the GitHub Release.** Use the CHANGELOG block as the body.
   ```bash
   gh release create vX.Y.Z --title "vX.Y.Z — one-line summary" --notes-file /tmp/notes.md
   ```
6. **Publish `@kelp/cli` to npm** — see below.

## Publishing `@kelp/cli` to npm

### One-time setup (only needed the very first time)

The `@kelp` scope has to exist on npm before you can publish under it. It
does NOT exist yet as of v0.2.0 — the previous cut only produced a GitHub
Release.

Two options:

**Option A — reserve the `@kelp` npm org** (recommended, matches the
workspace name):

1. `npm login`  (browser-based, 2FA)
2. Create the org at https://www.npmjs.com/org/create — pick "Free" tier,
   name = `kelp`. Public packages only, which is what we want.
3. Done. `npm publish --access public` from `apps/cli/` will now work.

**Option B — publish unscoped as `kelp-scan`** (also available, no org
gymnastics):

1. Rename `apps/cli/package.json` `"name"` to `"kelp-scan"`.
2. Update the root `package.json` `scripts.cli` to reference the new
   workspace name.
3. `npm login`.
4. `cd apps/cli && npm publish --access public`.

Either option is fine. Option A gives us `npx @kelp/cli scan …` and pairs
better with a possible future `@kelp/core` publish. Option B gives us
`npx kelp-scan …` which is arguably shorter to type. Pick and commit — do
NOT mix.

### Every release after that

```bash
# From the repo root
npm run build --workspace=@kelp/core
npm run build --workspace=@kelp/worker   # only if the CLI ever depends on it
npm run build --workspace=@kelp/cli

# Dry-run to sanity-check the tarball
cd apps/cli
npm publish --dry-run --access public

# When happy, publish for real
npm publish --access public

# Back to the repo root
cd ../..
```

### Verifying the published package

```bash
npx @kelp/cli --version
npx @kelp/cli scan ./some-repo
```

The bin name inside the package is `kelp`, so after `npm i -g @kelp/cli`
the invocation is `kelp scan …` regardless of the package name.

## Publishing `kelp-security/kelp-action` (separate repo)

Not covered here — that's the action repo, not this one. See
[`kelp-security/kelp-action`](https://github.com/kelp-security/kelp-action)'s
own README for the ncc bundle + tag flow. Short version:

```bash
cd ../kelp-action
npm run build
git add -A && git commit -m "vX.Y.Z"
git push
git tag -f v1 && git push -f origin v1     # floating major tag
git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z   # immutable tag
```

## When not to release

- Detections that are still WIP or unverified against real repos.
- Docs-only changes to files a user doesn't hit at install time (internal
  memory files, etc.).
- CI-only changes that don't affect the CLI or the Action.

Push those to master, let them ride the next real release.
