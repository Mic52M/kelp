# Changelog

All notable changes to Kelp are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and Kelp adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Unauthenticated Next.js route + server-action detection** (v0.13.0 of
  the CLI, issue #65). A static lexical analyzer over `app/**/route.ts`,
  legacy `pages/api/**`, and `"use server"` files flags exported handlers
  and actions that read or write with no recognized auth call. Two rules,
  `route_handler_no_auth` and `server_action_no_auth`, both medium
  confidence. Heuristic on purpose: mutations are flagged unconditionally,
  reads only when the file touches a backend, and signature-verified
  webhooks are treated as authenticated. Surfaced on `kelp scan` (new
  `ROUTE-AUTH` check), `--json`, `--report`, and the MCP `auth` class.
- **Static schema checks now run on `kelp scan`** (v0.12.0 of the CLI).
  The RLS and Storage ACL analyzers from 0.9.0 and 0.10.0 were only wired
  into the MCP surface, so the headline `kelp scan <path>` command silently
  dropped all six checks. They now surface in the normal report, `--json`,
  and `--report` output, with a `RLS-DEEP` row in CHECKS and per-rule
  remediation copy in the written report. Same migration parse, no extra
  cost. Guarded by two integration tests that spawn the CLI so the wiring
  can't regress to MCP-only again.
- **Multi-specialist agent squad** (v0.11.0 of the CLI, behind `--squad`).
  `kelp scan --agent --squad` splits into three focused specialists that
  run in parallel (`secrets`, `auth-routes`, `rls-edge`), each with its
  own share of the budget, plus a local reviewer that re-verifies every
  merged finding's `source_contains` against the file. Beta while we
  gather comparison data against the single-loop path.
- **Supabase Storage ACL analyzer** (v0.10.0 of the CLI). Reads
  `INSERT INTO storage.buckets` rows and `CREATE POLICY ON storage.objects`
  blocks from `supabase/migrations/*.sql`, runs three rules:
  `storage_public_bucket` (high), `storage_policy_missing_user_scope`
  (high), `storage_policy_permissive` (critical). Third pillar of the
  Supabase static scan alongside RLS and edge functions. Same parse pass
  as 0.9.0 so no extra cost.
- **Static RLS engine over repo SQL migrations** (v0.9.0 of the CLI).
  `kelp scan` and `kelp mcp` now read `supabase/migrations/*.sql`, build
  the schema graph (tables, columns, policies, foreign keys, grants,
  views), and run seven rules: the four base RLS checks
  (`rls_disabled`, `permissive_policy`, `owner_not_scoped`,
  `rls_no_policies`) plus three graph-level checks that catch classes
  no other scanner reports: `fk_leak_to_unprotected` (a protected table
  with a foreign key to an unprotected one, exploitable via PostgREST
  embed), `command_scope_gap` (SELECT policy + writable grants with no
  policy for the writes), and `view_bypasses_rls` (view over RLS base
  without `security_invoker = true`). Fully offline. 13 VULN/CONTROL
  test pairs.
- **`kelp mcp` — MCP server for LLM clients** (v0.8.0 of the CLI). Kelp
  now speaks Model Context Protocol on stdio, so Claude Code, Claude
  Desktop, Cursor, and any MCP-compatible client can call Kelp
  mid-conversation while an AI is generating code. Five tools
  (`scan_path`, `scan_snippet`, `list_rules`, `explain_finding`,
  `explain_rule`), two resources (`kelp://rules`, `kelp://rules/{id}`),
  two prompts (`/kelp:review-repo`, `/kelp:harden-file`). All local,
  offline, no data ever leaves the machine. See
  [`docs/MCP.md`](docs/MCP.md) for install snippets.
- **Stripe webhook signing secret detection** (#66). Recognizes `whsec_…`
  webhook signing secrets as `high` findings with Stripe attribution. A
  leaked `whsec_` lets anyone forge signed webhook payloads and bypass the
  "is this really from Stripe" check; the client-side severity bump lifts it
  to `critical` if the value ends up in a shipped bundle.
- **BackendAdapter interface** (@MayurK-cmd, #57). Every backend detection
  now goes through `BackendAdapter` in `@kelp/core/adapters`. The interface
  defines four mandatory operations: `detectFromRepo`, `parseSchema`,
  `discoverFunctions`, `analyzeAuth`. A strict registry rejects adapters
  missing any method or with the wrong arity. The Supabase adapter is the
  first implementation; the worker dispatches via `defaultBackendRegistry`
  and a shared `reconRepoViaRegistry()` helper. Sets the expansion order:
  Tier 1 (Supabase done, Firebase in #38), Tier 2 (Convex/Neon/PocketBase
  on demand), Tier 3 (Xano/Bubble/Airtable, never). No behavior change to
  existing scan paths.
- **Anthropic API key detection** (@be-student, #53). Recognizes current
  `sk-ant-api03-…` and legacy `sk-ant-…` credentials as critical findings
  with Anthropic attribution. Closes #48. Fixes the pre-existing bug where
  `sk-ant-…` values were mis-classified as `openai-key`.
- **OpenAI project-scoped key detection** (@MayurK-cmd, #55). `sk-proj-…`
  keys are flagged as `critical` via a dedicated `openai-project-key` rule.
  Closes #49. The generic `openai-key` rule now excludes both `ant-` and
  `proj-` via a combined negative lookahead so a key never fires twice.
- **"Open fix PR" hardening** (@MayurK-cmd, #56). The existing per-finding
  fix PR button now always opens a **draft** PR (never auto-merged), on a
  dedicated `kelp/fix-<fingerprint>` branch, with a `Kelp-Finding: <fingerprint>`
  trailer in both the PR body and the commit message so the push-webhook
  closure path can match a merged PR back to the finding. The button is
  gated by a shared `isPatchable` helper (`@kelp/core`); when the gate fails
  the button stays visible with the reason as its tooltip. Idempotent: a
  second click returns the existing PR URL. Event renamed to `fix_pr.opened`.

### Changed
- **CLI walker honors `.gitignore`** — `kelp scan <path>` now reads
  `.gitignore` files in the target tree (root and nested, via the
  `ignore` library) and skips ignored paths up front. `.env*` files are
  still walked unless they are ignored. On by default, no flag needed.

### Fixed
- **CLI color now honors `NO_COLOR` everywhere and the new `--no-color`
  flag** (#68). The decision lives in one `colorEnabled()` in
  `apps/cli/src/ui/style.ts` — `--no-color` > `NO_COLOR` (any non-empty
  value) > non-TTY stdout — and every ANSI helper gates on it, so
  escapes no longer leak into CI logs or piped output. `--json` output
  stays ANSI-free.

## [0.3.0] — 2026-09-01

Modernizes the CLI surface + ships the first working multi-agent scan.

### Added
- **Multi-agent scan** — `kelp scan <path> --agent` runs an autonomous
  Claude-driven auditor over the target repo. Streams a live transcript
  to stderr (timestamped, colored) so you see the agent reasoning +
  every tool call + every finding in real time. **Evidence-gated**:
  each `report_finding` must include a `source_contains` substring that
  is actually present at the cited path — the executor re-reads the
  file and drops the finding if the substring is absent. No fabrication.
- **Local agent toolbox**: `list_files` (glob-ish), `read_file`
  (200 KB cap), `grep` (regex), `report_finding` (evidence-gated).
  No shell, no HTTP, no writes to disk. Fully sandboxed.
- **Cost tracking** — per-scan cost in USD cents, running total
  emitted after each iteration. `--max-cost-cents` (default 100 = \$1)
  aborts the loop when exceeded. `--max-iterations` (default 24) is a
  belt-and-braces second cap.
- **Model selection** — `--model claude-sonnet-5` (default), or
  `claude-haiku-4-5`, `claude-opus-5`. Pricing table for each in
  `apps/cli/src/agent/pricing.ts`, updated 2026-09.
- **`@anthropic-ai/sdk`** added as a runtime dependency. Static-scan
  users don't pay any cost here — the SDK is only loaded when
  `--agent` is passed.

### Changed (Phase A — visual polish, no behaviour change)
- **ASCII banner** at the top of every scan run — 6-line KELP wordmark
  in the same signal green as the site.
- **Severity chips** — `▐ CRITICAL ▐` colored pills on TTY, brackets
  fallback on non-TTY.
- **Section rules** — unicode-heavy `━━ TARGET ━━━━━━` headers cap at
  terminal width.
- **Check status glyphs** — `✓ ok` / `⚠ warn` / `○ skip` per row.
- **INFO section** for edge-fn discovery uses `● mutating` /
  `● non-mutating` colored badges.
- **braille spinner** primitive (`⠋⠙⠹...`) available for future
  long-ops; auto-degrades in CI. Not yet wired to the static scan
  (fast enough to not need one) — used by the agent transcript.

### Notes
- Bundle: 26 KB → 44 KB (still esbuild-bundled). `@anthropic-ai/sdk`
  is marked `--external` so users get the current SDK from npm rather
  than a bundle-frozen copy — the SDK ships new features frequently
  and this keeps installs on the latest client.

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
