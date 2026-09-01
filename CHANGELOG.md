# Changelog

All notable changes to Kelp are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and Kelp adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [0.2.2] — 2026-09-01

Answers the "what is this thing actually scanning?" question. Previous
versions ran a single deterministic scanner and printed nothing when
that scanner had nothing to say — legitimately looked like a facade.
This release makes every check the CLI runs (and every check it can't
run and why) visible in the output.

### Added
- **`kelp scan` output — completely rewritten.** Every static check is
  named, its rule count is shown, and n/a cases are surfaced with the
  reason (no `supabase/config.toml`, no `supabase/functions/`, etc.).
  On a clean run you see the checks that ran + a "what Kelp cannot
  catch offline" block pointing at RLS live probing, edge-fn replay,
  BOLA, and the agent-driven scan.
- **`EDGE-003` static check** — parses `supabase/config.toml` for
  `verify_jwt = false` per function. High-severity finding; repo-only,
  no network needed.
- **`RECON` — edge function discovery.** Lists Supabase edge functions
  under `supabase/functions/`, classifies mutating vs non-mutating,
  informational only (no finding filed — hosted app probes the live URLs).
- **`kelp list-rules`** — introspect every rule the CLI runs, grouped
  by static vs live-only. Answers "what does this cover?" without
  needing to trigger a scan.
- **`kelp config`** — show the effective config: whether an Anthropic
  API key is set + where it came from (env vs `~/.config/kelp/config.json`)
  and where to write the file.
- **`--verbose` / `-V`** — per-check progress printed to stderr.
- **`ANTHROPIC_API_KEY` detection** — CLI now recognizes the env var
  and reads `~/.config/kelp/config.json` (XDG-aware). Not yet wired to
  agent-driven scans — the hint in `scan` output says what's coming.

### Changed
- JSON output schema bumped to `version: 2` — adds a `checks` block
  with per-check applicability + count, and `filesSkipped` breakdown.
  Existing `findings[]` shape is stable.
- Bundle size: 13 KB → 24 KB (still zero runtime deps).

## [0.2.1] — 2026-09-01

### Fixed
- `@kelp-security/cli` — bundle the CLI with esbuild instead of publishing
  a workspace-linked tsc output. v0.2.0 declared `@kelp/core: "*"` as a
  runtime dependency, which was a workspace-only alias and 404'd on
  `npm install`, breaking every downstream install. v0.2.1 is a single
  self-contained ESM bundle (~13 KB) with zero runtime dependencies.

## [0.2.0] — 2026-08-31

The open-source release. Repo is now public + MIT-licensed. First
standalone CLI. Full contributor docs.

### Added
- **`apps/cli` (`@kelp-security/cli`)** — first standalone CLI, `kelp scan <path>`,
  with `--json` and `--severity` flags. Reuses the same `@kelp/core`
  scanners as the hosted app and the GitHub Action, so CLI results are
  identical to CI results.
- **`docs/` folder** — `ARCHITECTURE.md`, `CLI.md`, `ADAPTERS.md`,
  `SECURITY-MODEL.md`, `EVIDENCE-GATING.md` (the anti-fabrication invariant,
  promoted to a first-class doc).
- **OSS scaffolding** — `LICENSE` (MIT), `SECURITY.md`, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), `CHANGELOG.md`.
- **GitHub scaffolding** — issue templates (`bug_report`, `feature_request`,
  `vulnerability_class`), PR template, `.github/workflows/ci.yml`
  (build + typecheck + tests).
- **`examples/workflows/kelp-check.yml`** — copy-paste starter for the
  Action.

### Changed
- **Root `README.md`** rewritten as a portfolio/OSS hero doc — badges,
  quickstarts for CLI, Action, and hosted app, links to `docs/`.
- **Landing (kelp.build)** repositioned around the OSS story — pricing
  section removed, Install/Coverage/Docs replaced the paid-tier nav,
  "Star on GitHub" is the primary CTA. Sign-in demoted to a small
  "Hosted app" link.
- **Login page** copy makes clear signing in is only needed for the
  hosted app's continuous scanning; CLI and Action work with zero signup.
- **Dashboard chrome** — Billing hidden from the top-level nav (the
  route still exists for the internal `founder` tier); sidebar
  "Upgrade" card replaced with a repo/docs pointer.
- **Repository is now public**, `Mic52M/kelp`. 12 discovery topics set,
  issues + discussions enabled.

## [0.1.0] — 2026-07-15

First public cut. Same day the hosted app went live at
[kelp.build](https://kelp.build) and the `kelp-security/kelp-action` GitHub
Action was published.

### Added
- **Hosted app** at `kelp.build` — GitHub OAuth signup, repo connect, dashboard,
  findings view, agent chat per finding, shareable public reports.
- **kelp/check GitHub Action** — fails PRs on new critical/high findings vs
  the base branch, posts a Kelp-branded comment on the PR, updated in place
  on subsequent commits.
- **Passive scanners** — secrets, RLS, edge-function `verify_jwt=false`, CORS,
  auth flow rate-limits.
- **Active pen-test engine** — multi-agent squad (data / edge / surface) with
  a reviewer that re-runs every reproduction. Evidence-gated.
- **Enable-check on-ramps** — auto-open PR at repo connect, dashboard button,
  copy-paste snippet on `/docs/action`.
- **Free scan MVP** — no-signup shareable report at `/r/<slug>`.
- **Multi-tenant Postgres** with RLS everywhere; encrypted credentials at
  rest; `founder` internal plan tier for the Kelp team.
