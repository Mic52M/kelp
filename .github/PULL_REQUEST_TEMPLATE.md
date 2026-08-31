<!--
Thanks for opening a PR!

Keep the description tight. What changes, why, and how someone can verify it.
Link the issue this closes (`Closes #123`) if there is one.

If you're adding a new detection, please make sure the fixture case is in
place before the pattern (see CONTRIBUTING.md for the test-first flow).
-->

## What

<!-- One or two sentences: what does this PR change? -->

## Why

<!-- Motivation. Fixed bug? New feature? Cleanup? Link to the issue. -->

## How to verify

<!-- Steps a reviewer can run to see the change work.
     `npm test`, `kelp scan ./examples/xxx`, a screenshot of the dashboard, etc. -->

## Checklist

- [ ] `npm run build --workspaces` passes.
- [ ] `npm test --workspaces` passes locally.
- [ ] Lint is clean.
- [ ] Docs updated for user-visible changes.
- [ ] CHANGELOG under `[Unreleased]` updated.
- [ ] No secrets, no `.env` files, no personal keys included.
- [ ] If this touches security-sensitive code (auth, credential storage,
      scanners), I've flagged the affected areas above.
