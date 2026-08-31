# Contributing to Kelp

Thanks for looking. Kelp is small on purpose — the goal is to keep the
detection engine honest and easy to extend, not to be a framework. Every
contribution helps.

## TL;DR for first-time contributors

1. **Vulnerability?** → [SECURITY.md](SECURITY.md), not a public issue.
2. **Bug or unclear behavior?** → [open an issue](https://github.com/Mic52M/kelp/issues/new/choose)
   with a reproduction.
3. **New detection or a fix?** → PR against `master`. Small PRs, one concern
   at a time.
4. **New backend adapter** (Firebase, Convex, etc.)? → read
   [docs/ADAPTERS.md](docs/ADAPTERS.md) first — the shape is intentional.

## Dev setup

Prerequisites: Node ≥ 20, npm ≥ 10, git, a Supabase project (only needed for
the hosted-app workflows — the CLI and unit tests run without it).

```bash
git clone https://github.com/Mic52M/kelp.git
cd kelp
npm install
cp .env.example .env.local
# Fill in .env.local — see .env.example for the required keys. All of them
# are optional for CLI-only or unit-test development.

# Build the shared packages
npm run build --workspace=@kelp/core
npm run build --workspace=@kelp/worker

# Run the web app (localhost:3000)
npm run dev --workspace=@kelp/web

# Run the CLI locally against a directory
npm run cli -- scan ./path/to/some/app
```

Everything else — Redis, GitHub App install, Supabase Auth — is only required
for feature areas that touch those systems. The unit-test suite runs on core
alone.

## Repo layout

```
apps/
├─ web/           Next.js — hosted app at kelp.build
└─ cli/           kelp binary — standalone Node CLI
packages/
├─ core/          detection engine (pure, no I/O). START HERE for detections.
├─ worker/        scan pipeline + GitHub/Supabase/queue integrations
└─ db/            SQL migrations
docs/             design docs, architecture, adapter API, threat model
examples/         reference workflow files and sample findings
```

## Coding conventions

- **TypeScript strict** everywhere.
- **No new deps** without a reason. Kelp is deliberately dependency-light.
- **Comments explain the WHY, not the WHAT**. If a comment describes what the
  code does, delete it or rename the variable so it doesn't need to.
- **Detection changes are TEST-FIRST**. Add or update a fixture in
  `packages/core/src/scanners/*.test.ts` before touching the scanner.
- **Never log secret values.** Ever. Not even during dev — Kelp's contract is
  that a raw secret never crosses the scanner boundary.
- Style is enforced by `eslint` + `prettier` (config in the root). PRs that
  fail lint will get flagged by CI.

## Adding a new detection

Kelp's detection engine (`packages/core/src/scanners/`) is a set of pure
functions that take source files and return findings — nothing else. To add
a new secret provider pattern, for example:

1. Add a fixture with the pattern and a control that *shouldn't* match to
   `packages/core/src/scanners/secrets.test.ts`.
2. Add the pattern to `KNOWN_PATTERNS` in `scanners/secrets.ts`.
3. Run `npm test --workspace=@kelp/core`. Both cases should pass.
4. Bump the CHANGELOG under `[Unreleased] → Added`.
5. Open a PR. The reviewer will check the pattern isn't so broad it flags
   plausible non-secrets (false-positive rate matters more than recall).

For larger new classes (a whole new vuln category), open an issue first so
we can align on the shape — evidence-gating, severity, remediation kind.

## Pull request checklist

Before you open a PR, make sure:

- [ ] `npm run build --workspaces` passes.
- [ ] `npm test --workspaces` passes.
- [ ] Lint (`npm run lint`) is clean.
- [ ] Documentation is updated for user-visible changes.
- [ ] The CHANGELOG under `[Unreleased]` is updated.
- [ ] Commits are meaningful (the body explains the why; the title is one line
  under 72 chars).
- [ ] No secrets, `.env` files, or personal keys committed.

## Code of conduct

By participating you agree to the [Contributor Covenant](CODE_OF_CONDUCT.md).
Be kind, assume good intent, keep discussions focused on the code and the
problem.

## Where to get help

- **Design questions** → open an issue with the `discussion` label.
- **How does X work?** → skim [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), then
  ask in an issue.
- **Something is broken but I don't know if it's a bug or my env** → open an
  issue with `bug: possible env issue` in the title and I'll help you narrow it.

Thanks for helping make Kelp better.
