# Changelog

All notable changes to Kelp are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and Kelp adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [0.2.0] — 2026-08-31

The open-source release. Repo is now public + MIT-licensed. First
standalone CLI. Full contributor docs.

### Added
- **`apps/cli` (`@kelp/cli`)** — first standalone CLI, `kelp scan <path>`,
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
