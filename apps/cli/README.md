# `kelp` — CLI

Standalone command-line entry point for [Kelp](../../README.md). Runs the same
detection engine (`@kelp/core`) as the hosted app and the GitHub Action, so
what you see locally is what CI would see.

## Install

```bash
npx kelp scan ./my-app
```

Or install globally:

```bash
npm install -g @kelp/cli
kelp scan ./my-app
```

## Usage

```
kelp scan <path> [options]

OPTIONS
  --json                     Emit findings as JSON on stdout
  --severity <sev>           Only show findings at or above <sev>
                             (critical|high|medium|low)
  --help, -h                 Show help
  --version, -v              Print version
```

### Examples

```bash
# Scan a local project
kelp scan ./my-app

# Machine-readable output
kelp scan ./my-app --json > findings.json

# Only gate on high+critical
kelp scan . --severity high
```

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Scan completed, no findings above the severity floor |
| `1` | Scan completed, at least one finding above the floor |
| `2` | Scan itself failed (bad path, unreadable target, etc.) |

Use `1` to gate a CI job:

```bash
kelp scan . --severity high || exit 1
```

## What gets scanned

The walker skips the well-known noise directories (`node_modules`, `.git`,
`dist`, `build`, `.next`, `vendor`, `__pycache__`, `.venv`, `target`,
`coverage`), lockfiles, sourcemaps, and minified bundles. Everything else is
handed to the scanner, which then applies its own path filters.

Files larger than 1 MB are skipped so a stray CSV dump doesn't stall the scan.

## What's detected

The v0.1 CLI runs the **secret** scanner from `@kelp/core`:

- Provider patterns for AWS, GCP, Stripe, Supabase, GitHub, Slack, OpenAI, and
  more (see [`packages/core/src/scanners/secrets.ts`](../../packages/core/src/scanners/secrets.ts)).
- Entropy fallback for high-entropy quoted strings not caught by a pattern.
- Client-side severity bump — a secret shipped to every visitor is more
  dangerous than one in server code.

Secret values themselves never leave the scanner boundary: findings carry a
masked preview (`sk_live_…`) only.

RLS, edge-function, and BOLA scanners live in `@kelp/core` too and will land
in the CLI progressively — see the [roadmap issue](https://github.com/Mic52M/kelp/issues).

## Docs

- [Full CLI reference](../../docs/CLI.md)
- [Architecture](../../docs/ARCHITECTURE.md)
- [Contributing](../../CONTRIBUTING.md)

## License

MIT — see [LICENSE](../../LICENSE).
