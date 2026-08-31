<div align="center">

# Kelp

**Security scanner for vibe-coded apps.**
Finds the doors AI code generators leave open — hardcoded secrets, permissive
RLS, unauthenticated edge functions — and gates them out of your pull requests.

[![License: MIT](https://img.shields.io/badge/License-MIT-signal.svg?labelColor=0a0a0c&color=b8f2c9)](LICENSE)
[![CI](https://github.com/Mic52M/kelp/actions/workflows/ci.yml/badge.svg)](https://github.com/Mic52M/kelp/actions/workflows/ci.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-signal.svg?labelColor=0a0a0c&color=b8f2c9)](CONTRIBUTING.md)
[![Deploy](https://img.shields.io/badge/kelp.build-live-signal.svg?labelColor=0a0a0c&color=b8f2c9)](https://kelp.build)

[Live app](https://kelp.build) · [Docs](docs/) · [CLI](docs/CLI.md) · [GitHub Action](https://github.com/kelp-security/kelp-action) · [Architecture](docs/ARCHITECTURE.md)

</div>

---

## What it does

Kelp scans an app's **backend surface** — Supabase (managed backends included),
edge functions, RLS policies, source tree — the way an attacker would. Every
finding is **evidence-gated**: a reviewer re-runs the reproduction before it
lands in your report, so what you see is what an attacker would actually get.

Three surfaces, one detection engine:

| Surface | For | How you use it |
|---|---|---|
| **CLI** — [`kelp`](docs/CLI.md) | Local scans, CI shells, scripts | `npx kelp scan ./my-app` |
| **GitHub Action** — [`kelp/check`](https://github.com/kelp-security/kelp-action) | Pull-request gating | `uses: kelp-security/kelp-action@v1` |
| **Hosted app** — [kelp.build](https://kelp.build) | Continuous scanning, dashboard, PR fixes | Connect a repo, sign in with GitHub |

Zero configuration in the common case. The Action reads the workflow's
`GITHUB_TOKEN`, the hosted app installs a GitHub App, the CLI walks the
filesystem.

## Quickstart — CLI

```bash
npx kelp scan ./my-app
```

```
kelp v0.1.0  ·  scanning ./my-app  ·  214 files walked

CRITICAL  src/lib/db.ts:14   VITE_SERVICE_ROLE — Supabase service_role JWT
HIGH      src/api/orders.ts  hardcoded Stripe secret (sk_live_…)
MEDIUM    supabase/config.toml  verify_jwt=false on get-order

3 findings · 8s · report at ./kelp-report.json
```

Add `--json` for machine-readable output, `--severity high` to filter, or see
[docs/CLI.md](docs/CLI.md) for the full reference.

## Quickstart — GitHub Action

Add `.github/workflows/kelp-check.yml`:

```yaml
name: kelp/check
on:
  pull_request:
    branches: [main]
permissions:
  contents: read
  pull-requests: read
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: kelp-security/kelp-action@v1
```

Kelp will run on every PR, comment the verdict on the PR, and fail the check
when new **critical or high** findings are introduced against the base branch.
See [the action docs](https://github.com/kelp-security/kelp-action) for inputs
and required-status-check setup.

## What Kelp checks today

| Class | How | Output |
|---|---|---|
| **Secrets** in source | Provider patterns (AWS/GCP/Stripe/Supabase/…) + entropy fallback | Masked preview + line + severity |
| **Supabase RLS** | Reads schema + policies, flags tables open to `anon` | Proposed migration snippet |
| **Edge functions** | Replays without a JWT to detect `verify_jwt=false` | Function name + reproduction curl |
| **CORS + auth flows** | Reads config + auth callbacks for permissive defaults | Config diff |
| **BOLA** (opt-in, hosted only) | Active test with two user-provided test accounts | Human-review only, never auto-fix |

New detections land in [packages/core/src/scanners/](packages/core/src/scanners/).
See [docs/ADAPTERS.md](docs/ADAPTERS.md) for extending Kelp to other backends
(Firebase, Convex, PocketBase — see the [north-star issue](https://github.com/Mic52M/kelp/issues/45)).

## Architecture

Monorepo (npm workspaces). Three surfaces share one engine:

```
apps/
├─ web/           Next.js — hosted app at kelp.build
└─ cli/           kelp binary — standalone Node CLI
packages/
├─ core/          detection engine (pure, no I/O)
├─ worker/        scan pipeline + integrations (GitHub, Supabase, queue)
└─ db/            SQL migrations
```

The **core** is intentionally I/O-free: it takes `SourceFile[]` and returns
`Finding[]`. The CLI shells file-reads to it; the worker adds the GitHub App
plumbing; the web app adds auth, storage, and the reviewer loop.

Full breakdown: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Evidence-gating

Kelp's most important invariant: **the model never decides a finding is real.**
Every agent-produced lead requires a reproduction (probe + expected observable,
or a source citation). The executor re-runs it and records the finding only if
the observable holds. Autonomy in reasoning, zero fabrication.

Read the full principle at [docs/EVIDENCE-GATING.md](docs/EVIDENCE-GATING.md).

## Contributing

PRs, bug reports, and new detection classes are welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md) for the dev setup and the review checklist.
Security vulnerabilities go through [SECURITY.md](SECURITY.md), not the public
issue tracker.

Good first contributions:
- A new secret provider pattern in
  [`packages/core/src/scanners/secrets.ts`](packages/core/src/scanners/secrets.ts).
- A new edge-function heuristic in
  [`packages/core/src/agent/edge-functions.ts`](packages/core/src/agent/edge-functions.ts).
- Docs improvements — the tutorials in `docs/` are always in flight.

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgements

Kelp exists because vibe-code tools ship a lot of the same footguns, and the
people using them shouldn't need a security team to catch them. Built by
[@Mic52M](https://github.com/Mic52M) — solo, in the open.
