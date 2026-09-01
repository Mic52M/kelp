# Publishing

How to cut a new release + push `@kelp-security/cli` to npm. Not something contributors
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
6. **Publish `@kelp-security/cli` to npm** — see below.

## Publishing `@kelp-security/cli` to npm

### One-time setup — already done

The `@kelp-security` npm org exists (owner: `mic52m`). Free tier, public
packages only. Matches the GitHub org that owns `kelp-security/kelp-action`.

`@kelp-security/cli@0.2.0` was published on 2026-09-01. Nothing more to
set up — subsequent publishes just need `npm login` (or a granular access
token) and the "every release after that" flow below.

### Every release after that

```bash
# From the repo root
npm run build --workspace=@kelp/core
npm run build --workspace=@kelp/worker   # only if the CLI ever depends on it
npm run build --workspace=@kelp-security/cli   # note: still lives in apps/cli

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
npx @kelp-security/cli --version
npx @kelp-security/cli scan ./some-repo
```

The bin name inside the package is `kelp`, so after `npm i -g @kelp-security/cli`
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
