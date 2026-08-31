# CLI reference — `kelp`

Standalone command-line scanner. Uses the same detection engine
(`@kelp/core`) as the hosted app at [kelp.build](https://kelp.build) and the
[`kelp/check` GitHub Action](https://github.com/kelp-security/kelp-action), so
CLI results are identical to CI results.

## Install

Zero-install:

```bash
npx kelp scan ./my-app
```

Or global:

```bash
npm install -g @kelp/cli
kelp scan ./my-app
```

Requires Node ≥ 20.

## Commands

### `kelp scan <path>`

Walk `<path>` and scan every eligible file for hardcoded secrets and other
supported classes. Returns a pretty table by default, or a JSON report with
`--json`.

```
kelp scan <path> [options]

OPTIONS
  --json                     Emit findings as JSON on stdout
  --severity <sev>           Only include findings at or above <sev>
                             (critical | high | medium | low)
  --help, -h                 Show help
  --version, -v              Print version
```

### `kelp --version`

Print the CLI version.

### `kelp --help`

Show a compact usage summary.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Scan completed, no findings above the severity floor |
| `1` | Scan completed, at least one finding above the floor |
| `2` | Scan itself failed (bad path, unreadable target, etc.) |

Chain a CI job on the exit code:

```bash
kelp scan . --severity high || exit 1
```

## What gets walked

The CLI's walker skips these directories up front without stat'ing them:

- `node_modules`, `.git`
- `dist`, `build`, `.next`, `.turbo`
- `vendor`, `__pycache__`, `.venv`, `target`, `coverage`

Dotfiles and dotdirs are skipped **except `.env*`** — those are exactly the
files the scanner needs to inspect.

Files larger than **1 MB** are skipped so a stray CSV or lockfile doesn't
stall the scan.

Everything else is offered to the scanner, which then applies its own path
filter (`shouldScanPath` in `@kelp/core`): lockfiles, sourcemaps, and
`.env.example` are dropped there.

## What's detected

v0.1 CLI runs the **secret** scanner from `@kelp/core`:

- Provider patterns (AWS, GCP, Stripe, Supabase, GitHub, Slack, OpenAI, …)
- Entropy fallback for high-entropy quoted strings that no pattern matched
- Client-side severity bump — a secret shipped to every visitor is more
  dangerous than one in server code (`clientSide: true` in the JSON output)

Secret **values** never leave the scanner boundary. Findings carry a masked
preview (`sk_live_…`) only — you can safely pipe `kelp scan --json` into a
public log without leaking anything.

Other classes (RLS, edge functions, CORS, BOLA) live in `@kelp/core` too and
will land in the CLI progressively.

## JSON output schema

```json
{
  "version": 1,
  "tool": { "name": "kelp", "version": "0.1.0" },
  "target": "/absolute/path/to/scanned/dir",
  "scannedAt": "2026-08-31T16:06:12.175Z",
  "filesScanned": 214,
  "durationMs": 42,
  "findings": [
    {
      "fingerprint": "be5e5a31b66aee562874a4c9c074aab4",
      "ruleId": "stripe-secret-live",
      "provider": "Stripe",
      "title": "Stripe live secret key",
      "severity": "critical",
      "path": "src/config.ts",
      "line": 2,
      "preview": "sk_l…KLLL",
      "clientSide": false,
      "confidence": "high"
    }
  ]
}
```

`fingerprint` is stable across scans for the same finding at the same
location — the hosted app uses it for dedup, and downstream tools can too.

`preview` is always masked.

## Colour output

Colours turn on automatically when stdout is a TTY. Set `NO_COLOR=1` (or pipe
to a file) to disable.

## Comparison — CLI vs GitHub Action vs hosted app

| | CLI | Action | Hosted |
|---|---|---|---|
| Runs on | Local machine, CI shell | GitHub-hosted runner | Vercel (Kelp-hosted) |
| Auth | None | Workflow's `GITHUB_TOKEN` | GitHub App + Supabase Auth |
| Diff vs base branch | ❌ (all findings) | ✅ (gates on new only) | ✅ |
| PR comment | ❌ | ✅ | ✅ |
| Dashboard, history, chat | ❌ | ❌ | ✅ |
| Active pen-test (agent squad) | ❌ | ❌ | ✅ |
| Config | Zero | Zero | Sign up |

The CLI is the fastest way to try Kelp on a repo you already have locally.

## Reporting bugs

[Open an issue](https://github.com/Mic52M/kelp/issues) with `kelp --version`,
the target you scanned, and the output you got. Redact any secret values
before pasting.
