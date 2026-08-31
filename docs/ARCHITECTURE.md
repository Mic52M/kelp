# Architecture

Kelp is a monorepo. Three product surfaces — CLI, GitHub Action, and hosted
web app — share **one detection engine** so what you see locally is what CI
sees and what the hosted app sees.

```
                    ┌────────────────────┐
                    │   @kelp/core       │  pure detection: (files) → findings
                    │   scanners, agents │  no I/O, no db, no network
                    │   evidence gates   │
                    └─────────┬──────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
 ┌─────────────┐      ┌──────────────┐      ┌──────────────┐
 │  apps/cli   │      │ @kelp/worker │      │  apps/web    │
 │  kelp scan  │      │ scan pipeline│      │  Next.js UI  │
 │             │      │ GitHub App   │      │  hosted at   │
 │  filesystem │      │ Supabase API │      │  kelp.build  │
 │  in         │      │ queue        │      │              │
 └─────────────┘      └──────┬───────┘      └──────┬───────┘
                             │                     │
                             │     ┌───────────────┘
                             ▼     ▼
                     ┌───────────────────┐
                     │  kelp-security/   │
                     │  kelp-action@v1   │
                     │  (separate repo)  │
                     └───────────────────┘
```

## Package boundaries

The layering is strict. Nothing above ever imports from a layer below it.

### `packages/core` — pure detection engine

- **Contract**: pure functions of the shape `(inputs) → findings`. No I/O
  in this package, ever.
- **What lives here**:
  - `scanners/` — secret patterns, RLS analysis, edge-fn heuristics
  - `agent/` — multi-agent orchestration + evidence-gated `report_finding`
  - `remediation/` — how to build a fix PR body, how to redact secret
    values in outputs
  - `types.ts` — the domain types (`VulnClass`, `Severity`, `FindingStatus`)
  - `plans.ts` — plan-tier limits (see also
    [`memory/backend-adapter-strategy.md`](../memory/backend-adapter-strategy.md))
- **What DOESN'T live here**: reading files, calling GitHub, talking to
  Postgres, or hitting the Anthropic API directly. Anything I/O-shaped
  belongs a layer up.

### `packages/worker` — scan pipeline + integrations

- **Contract**: side-effectful runners that use `@kelp/core`. Own the
  connectors and the queue.
- **What lives here**:
  - `connectors/github.ts` — GitHub App JWT, installation tokens, `openFixPr`,
    `openFileCreationPr`, `upsertPrComment`
  - `connectors/supabase-pg.ts` — read-only Postgres connections
  - `scan-processor.ts` — the passive-scan pipeline
  - `agent/anthropic-driver.ts` — the LLM driver with prompt caching
  - `db.ts` — every SQL query the platform runs
  - `enable-check-pr.ts`, `pr-check-comment.ts`, `fix-pr.ts` — task-specific
    orchestrators built on top of the connectors
- **Consumers**: `apps/web` (server-side API + server actions) and any
  future long-running scan worker.

### `packages/db` — SQL migrations

Numbered `.sql` files under `migrations/`. Each is self-contained and idempotent
where practical (uses `IF NOT EXISTS`). The SQL is the source of truth for the
schema; TS types in `packages/core/types.ts` mirror the enums.

Migration ordering matters — the pipeline `migrate.ts` applies files in
filename order.

### `apps/cli` — standalone command-line

- Depends only on `@kelp/core`.
- Walks the filesystem, filters via `shouldScanPath`, calls scanner functions,
  prints a pretty table or JSON.
- Zero configuration. No Kelp API needed, no signup, no keys.
- See [`docs/CLI.md`](CLI.md).

### `apps/web` — hosted app

- Next.js 15 (App Router). Deploys to Vercel.
- Auth via Supabase (Google + GitHub OAuth + email/password).
- Server actions call `@kelp/worker` for anything side-effectful.
- Deploys as a single Next runtime; no separate worker process today
  (long-running scans use Vercel's `after()` primitive; the queue is Redis-
  optional).
- Live at [kelp.build](https://kelp.build).

### `Mic52M/kelp-action` → `kelp-security/kelp-action` (separate repo)

- TypeScript GitHub Action bundled with `@vercel/ncc`.
- Reads the `pull_request` context, POSTs to the hosted app's
  `/api/scan/from-action`, polls, fails the PR check on gating findings.
- Auth is the workflow's ephemeral `GITHUB_TOKEN` — no Kelp-side API key.
- See [`docs/CLI.md`](CLI.md) for a comparison with the CLI.

## The scan pipeline (hosted app)

Ordered by wall-clock during a typical PR-check scan:

```
Action POST /api/scan/from-action
  ├─ round-trip verify GITHUB_TOKEN against api.github.com/repos/{owner/repo}
  ├─ findAnyProjectByRepo → project row (via github_installations)
  └─ enqueueScanForProject({ trigger: pr_check, headSha, baseSha, prNumber })
        └─ inserts row in `scans` (status=queued)

worker/scan-processor
  ├─ claimQueuedScan → row (status=running)
  ├─ createGitHubConnector({ installationId }) → App installation JWT
  ├─ listSourceFiles(repo, headSha) → fetch /tarball/{sha}
  ├─ core.runScan({ files, classes, headSha })
  │     └─ deterministic scanners produce findings
  ├─ upsertFindings → dedup on fingerprint
  ├─ finishScan(status=succeeded)
  └─ postPrCheckComment → upsertPrComment (find-by-marker + PATCH)

Action polls GET /api/scan/status/[id]
  └─ returns counts { critical, high, medium, low }, newFindings, reportSlug
  └─ core.setFailed if newFindings.<gated> > 0
```

## Evidence-gating (the anti-fabrication invariant)

The most important invariant: **the LLM never decides a finding is real**.
Every agent-produced lead requires a reproduction (probe + expected
observable, or a source citation). The executor re-runs it and records the
finding only if the observable holds (`status_2xx`, `returns_rows`,
`row_owned_by_other`, `callback_fired`, `header_matches`, `source_contains`).

Autonomy in reasoning, zero fabrication.

See [`docs/EVIDENCE-GATING.md`](EVIDENCE-GATING.md) for the full principle and
how it's implemented in `packages/core/src/agent/`.

## Where things live — quick lookup

| I want to… | Look at |
|---|---|
| Add a new secret pattern | [`packages/core/src/scanners/secrets.ts`](../packages/core/src/scanners/secrets.ts) |
| Change how RLS is analyzed | [`packages/core/src/scanners/rls.ts`](../packages/core/src/scanners/rls.ts) |
| Add a new active-pentest specialist | [`packages/core/src/agent/`](../packages/core/src/agent/) |
| Change the GitHub App install flow | [`apps/web/app/api/auth/callback/`](../apps/web/app/api/auth/callback/) + [`apps/web/app/api/github/setup/`](../apps/web/app/api/github/setup/) |
| Change how PR comments are rendered | [`apps/worker/src/pr-check-comment.ts`](../apps/worker/src/pr-check-comment.ts) |
| Add a new plan tier | [`packages/core/src/plans.ts`](../packages/core/src/plans.ts) + migration on `plan_tier` enum |
| Add a schema change | New file in [`packages/db/migrations/`](../packages/db/migrations/) |
| Add a new CLI command | [`apps/cli/src/index.ts`](../apps/cli/src/index.ts) + `commands/` |
| Publish a new Action version | Repo `kelp-security/kelp-action`, `npm run build`, force-push `v1` tag |
