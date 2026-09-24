# CLI reference — `kelp`

Standalone command-line scanner. Uses the same detection engine
(`@kelp/core`) as the hosted app at [kelp.build](https://kelp.build) and the
[`kelp/check` GitHub Action](https://github.com/kelp-security/kelp-action), so
CLI results are identical to CI results.

## Install

Zero-install:

```bash
npx @kelp-security/cli scan ./my-app
```

Or global:

```bash
npm install -g @kelp-security/cli
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
  --agent                    Run the multi-agent Claude-driven scan on top
                             of the static checks. Requires ANTHROPIC_API_KEY.
  --model <id>               Anthropic model (default: claude-sonnet-5;
                             also: claude-haiku-4-5, claude-opus-5)
  --max-cost-cents <n>       Cost cap for --agent (default: 100 = $1.00)
  --max-iterations <n>       Iteration cap for --agent (default: 24)
  --json                     Emit findings as JSON on stdout
  --severity <sev>           Only include findings at or above <sev>
                             (critical | high | medium | low)
  --verbose, -V              Print per-check progress to stderr
  --no-color                 Disable ANSI colors (also honors NO_COLOR and
                             non-TTY stdout)
  --help, -h                 Show help
  --version, -v              Print version
```

### Agent-mode examples

```bash
# Set the key once
export ANTHROPIC_API_KEY=sk-ant-…

# Default: sonnet-5, capped at $1 and 24 iterations
kelp scan . --agent

# Cheaper — haiku-4-5, 50 cents cap
kelp scan . --agent --model claude-haiku-4-5 --max-cost-cents 50

# Deeper — opus-5, $5 cap, more iterations
kelp scan . --agent --model claude-opus-5 --max-cost-cents 500 --max-iterations 40
```

The agent transcript streams to stderr as it happens (one timestamped line
per event), so you can watch it reason + call tools + verify findings in
real time.

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

`.gitignore` files (root and nested) are honored on by default: anything
ignored — including an ignored `.env*` — is never walked. A deeper
`.gitignore` can re-include (`!pattern`) what a shallower one ignored,
matching git semantics.

Files larger than **1 MB** are skipped so a stray CSV or lockfile doesn't
stall the scan.

Everything else is offered to the scanner, which then applies its own path
filter (`shouldScanPath` in `@kelp/core`): lockfiles, sourcemaps, and
`.env.example` are dropped there.

## What's detected

### Static checks (always run)

- **SEC-001 — Hardcoded secrets.** Provider patterns (AWS, GCP, Stripe, Supabase,
  GitHub, Slack, OpenAI, Anthropic, …) plus an entropy fallback for high-entropy
  quoted strings that no pattern matched. Client-side severity bump — a secret
  shipped to every visitor is more dangerous than one in server code
  (`clientSide: true` in the JSON output). Values are always masked
  (`sk_live_…`) — the raw secret never leaves the scanner boundary.
- **EDGE-003 — Supabase `verify_jwt=false`.** Parses `supabase/config.toml`
  for per-function `verify_jwt = false`; HIGH severity finding.
- **RECON — Edge function discovery** (informational). Enumerates
  `supabase/functions/*/index.ts`, classifies mutating vs non-mutating.
  No finding filed; hosted app probes the live URLs.
- **RLS-DEEP — Static RLS over `supabase/migrations/*.sql`.** Parses the
  migrations into a schema graph (tables, columns, policies, foreign keys,
  grants, views) and runs the base RLS checks plus three graph-level ones:
  `fk_leak_to_unprotected` (a protected table with a foreign key to an
  unprotected one), `command_scope_gap` (a policy covers SELECT but not the
  writes a grant still allows), and `view_bypasses_rls` (a view over a
  protected table created without `security_invoker = true`).
- **STORAGE — Supabase Storage ACL.** Over the same migration parse:
  `storage_public_bucket` (a bucket created with `public = true`),
  `storage_policy_missing_user_scope` (an `storage.objects` policy with no
  `auth.uid()` / owner check), and `storage_policy_permissive`
  (`USING (true)` / `WITH CHECK (true)` for a client-facing role).
- **ROUTE-AUTH — Next.js route + server-action auth** (heuristic, medium
  confidence). Flags exported handlers in `app/**/route.ts` and legacy
  `pages/api/**`, and `"use server"` actions, that read or write with no
  recognized auth call. Mutations are flagged unconditionally; reads only
  when the file touches a backend; signature-verified webhooks are skipped.
- **FIREBASE — Firestore + Storage security rules.** Reads `firestore.rules`
  and `storage.rules`: `firebase_rule_public` (`allow ...: if true`),
  `firebase_rule_unauthenticated_write` (a write with no `request.auth`
  check), and `firebase_rule_write_no_owner` (a signed-in write with no
  owner binding). Rules that delegate to a user-defined `function()` helper
  are treated as guarded, so only the unambiguous `if true` fires through them.

### Agent-driven scan (opt-in, needs `ANTHROPIC_API_KEY`)

`kelp scan . --agent` runs an autonomous Claude-driven auditor over the repo.
The agent has a small local toolbox (`list_files`, `read_file`, `grep`,
`report_finding`) and is trained to look for:

- Missing auth checks in server actions / API routes
- Edge functions that check identity from the body/query instead of the JWT
- Open redirects in auth callbacks
- Client-side leaks of backend-only env vars (`SUPABASE_SERVICE_ROLE_KEY` and friends)
- Secret variants the pattern scanner missed

**Evidence gate**: every `report_finding` requires a `source_contains`
substring. The executor re-reads the cited file and drops the finding if the
substring isn't found. Autonomy in reasoning, zero fabrication.

**Cost caps**: default `--max-cost-cents 100` (\$1). Bump for larger repos
(`--max-cost-cents 500` = \$5 typical for a mid-size Next.js + Supabase app).

Full list at any time: `kelp list-rules`.

## JSON output schema

```json
{
  "version": 2,
  "tool": { "name": "kelp", "version": "0.14.0" },
  "target": "/absolute/path/to/scanned/dir",
  "scannedAt": "2026-09-24T16:06:12.175Z",
  "filesScanned": 214,
  "filesSkipped": { "oversize": 0, "unreadable": 0 },
  "checks": {
    "secrets": { "applicable": true, "findings": 1 },
    "supabaseConfigVerifyJwt": { "applicable": true, "findings": 0 },
    "edgeFnRecon": { "applicable": false, "discovered": 0, "mutating": 0 },
    "rlsSchema": { "applicable": true, "findings": 2 },
    "storageAcl": { "applicable": true, "findings": 1 },
    "nextjsRoutes": { "applicable": true, "findings": 1 },
    "firebaseRules": { "applicable": false, "findings": 0 },
    "agent": { "ran": false }
  },
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
      "confidence": "high",
      "source": "secrets"
    }
  ]
}
```

Each finding carries a `source` (`secrets`, `supabase-config`, `rls-sql`,
`storage-acl`, `nextjs-routes`, `firebase-rules`, or `agent`) so downstream
tools can tell which check produced it. Schema-level findings (RLS, storage)
use the schema object as `path` (e.g. `public.orders`, `storage.buckets/docs`)
with `line: 1`.

`fingerprint` is stable across scans for the same finding at the same
location — the hosted app uses it for dedup, and downstream tools can too.

`preview` is always masked.

## Colour output

Colours turn on automatically when stdout is a TTY. They turn off when
stdout is piped, when `NO_COLOR` is set to any non-empty value, or when
`--no-color` is passed. The flag is per-invocation and takes precedence over
the environment variable.

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
