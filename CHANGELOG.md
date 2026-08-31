# Changelog

All notable changes to Kelp are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and Kelp adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `apps/cli` — first standalone CLI, `kelp scan <path>`. Reuses the same
  `@kelp/core` scanners the hosted app runs.
- `docs/` folder with architecture, CLI reference, adapter API, security
  model, and evidence-gating principle.
- OSS scaffolding — LICENSE (MIT), SECURITY.md, CONTRIBUTING.md,
  CODE_OF_CONDUCT.md, CHANGELOG.md, GitHub issue and PR templates, and a
  CI workflow.

### Changed
- Root README rewritten as a portfolio/OSS hero doc — quickstarts for CLI,
  Action, and hosted app.
- Repository is now public.

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
