# @kelp-security/cli — changelog

## 0.15.0 — 2026-09-26

Detection for backend secrets exposed to the browser through a public
env-var prefix. This is the single most catastrophic Supabase footgun in
vibe-coded apps: a `service_role` key named `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`
(or the `VITE_...SERVICE_ROLE...` shape) gets inlined into the client bundle,
ships to every visitor, and bypasses Row Level Security entirely, giving
anyone full read/write on the whole database.

### Added

- **`client_exposed_secret`** (critical / high). Flags a var named with a
  public build-tool prefix (`NEXT_PUBLIC_`, `VITE_`, `REACT_APP_`,
  `EXPO_PUBLIC_`, `NUXT_PUBLIC_`, `GATSBY_`, `NG_APP_`, `PUBLIC_`) that also
  carries a backend-secret name: `SERVICE_ROLE`, `SERVICE_KEY`, `PRIVATE_KEY`,
  `SECRET_KEY`, `PASSWORD` (critical), or a trailing `_SECRET` / `PRIVATE` /
  `ADMIN_*` credential (high). Catches the reference by naming convention even
  when the value lives only in the deploy environment, which the literal
  secret scanner cannot see.
- Anon and publishable keys are public by design, so `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, a Firebase `apiKey`, and OAuth client
  ids are explicitly excluded.
- Surfaced on `kelp scan` (new `CLIENT-ENV` check row), `--json`
  (`checks.clientEnv`), and written reports with remediation. MCP returns it
  under the `secret` class, and `list_rules` / `explain_rule` carry the spec.
- Wired into the landing-page free scan (funnel) under the `exposure` class.
- 11 core rule tests (VULN/CONTROL per tier plus precision cases: anon,
  publishable, bare API keys, and feature-flag-shaped names stay quiet) and
  1 CLI integration test. Core tests: 363. CLI tests: 39.

### Notes

- High precision by construction: the prefix has a defined framework meaning
  and the dangerous suffixes are matched as whole segments, so
  `NEXT_PUBLIC_SECRET_SANTA_ENABLED` does not fire. The generic trailing
  `_SECRET` tier is `confidence: medium`; `SERVICE_ROLE` and friends are
  `confidence: high`.

## 0.14.0 — 2026-09-22

Firebase support. Kelp now understands a second backend: alongside the
Supabase static engine, it reads Firebase Security Rules (Firestore +
Cloud Storage) straight from the repo and flags the misconfigurations
vibe-coded Firebase apps reliably ship. This is the first adapter built on
the `BackendAdapter` seam from #45, and it validates that the interface
holds for a backend that gates data with a `.rules` DSL instead of Postgres
RLS.

### Added

- **Firebase Security Rules analyzer** over `firestore.rules` /
  `storage.rules`, three rules:
  - **`firebase_rule_public`** (critical for writes, high for reads).
    `allow ...: if true` — the path is open to the internet.
  - **`firebase_rule_unauthenticated_write`** (high). A write whose
    condition never references `request.auth`.
  - **`firebase_rule_write_no_owner`** (high). A signed-in write with no
    binding to the document owner, so any authenticated user overwrites
    anyone's data. The Firebase version of an RLS policy that checks the
    JWT exists but not `auth.uid()`.
- **`firebaseAdapter`**, the second `BackendAdapter`. `detectFromRepo`
  (firebase.json / .firebaserc / *.rules / firebase SDK import),
  `parseSchema` (collections + allow rules out of firestore.rules),
  `discoverFunctions` (v1 and v2 Cloud Functions under `functions/`),
  and `analyzeAuth` (delegated to the shared auth-model helper). Registered
  in the default registry after Supabase, so a Supabase repo still resolves
  to Supabase.
- `kelp scan` surfaces the rule findings in the normal report (new
  `FIREBASE` check row), `--json` (`checks.firebaseRules`), and written
  reports with per-rule remediation. MCP `scan_path` / `scan_snippet`
  return them under the `rls` class, and `list_rules` / `explain_rule`
  carry the specs.
- 11 core rule tests (VULN/CONTROL per rule plus opaque-helper and
  service-detection cases), 9 adapter tests, and 1 CLI integration test.
  Core scanner + adapter tests: 117. CLI tests: 38.

### Notes

- The rules analyzer is a lexical evaluator, not a full rules interpreter.
  The rules language has user-defined `function` helpers it can't follow,
  so a condition that calls one is treated as guarded and only the
  unambiguous `if true` is flagged through it. `firebase_rule_public` is
  `confidence: high`; the other two are `confidence: medium`.
- Firestore is schemaless, so the adapter's `parseSchema` reports the
  collection paths the rules mention rather than a column graph.

## 0.13.0 — 2026-09-22

Static detection for unauthenticated Next.js route handlers and server
actions (issue #65). The SQL analyzer reads Supabase RLS, but the leak
often lives one layer up: an `app/api/orders/route.ts` that writes the DB
with no `auth.getUser()`, a `pages/api/*` handler that trusts the client,
a `"use server"` action that reads `formData` and mutates without checking
who is calling. This catches those from source alone, no live target.

This is a heuristic and every finding is `confidence: medium`. There is no
type information and auth can be enforced a dozen ways (middleware, a
wrapper, a helper in another file), so the analyzer errs toward silence:
if a file has any recognized auth signal, none of its handlers are flagged.

### Added

- **`route_handler_no_auth`** (medium for mutations, low for reads).
  Fires on an exported `GET`/`POST`/`PUT`/`PATCH`/`DELETE` handler in
  `app/**/route.ts` (or a legacy `pages/api/**` default export) when the
  file has no auth call anywhere. Mutations are flagged unconditionally;
  a `GET` is flagged only when the file also touches a backend, so public
  health and echo routes stay quiet.
- **`server_action_no_auth`** (medium). Fires on a `"use server"` exported
  action that reads `formData` (or touches a backend) with no auth call.
  Server actions are public POST endpoints, so this is the same exposure
  as an open route.
- Webhooks verified by signature (Stripe `constructEvent`, svix, an HMAC
  over `x-hub-signature`, `timingSafeEqual`) count as authenticated and
  are not flagged.
- `kelp scan` surfaces these in the normal report (new `ROUTE-AUTH` row in
  CHECKS), `--json` (`checks.nextjsRoutes`), and written reports, with
  targeted remediation copy per rule.
- MCP `scan_path` / `scan_snippet` return them under the `auth` class, and
  `list_rules` / `explain_rule` carry the specs.
- 14 new core tests (VULN/CONTROL per branch plus noise-suppression cases)
  and 1 CLI integration test that spawns the CLI over a route fixture.
  Core scanner tests: 78. CLI tests: 37.

### Notes

- No new dependency. The analyzer is a lexical pass, not a full AST parse,
  to keep the bundle small and match the heuristic confidence level. The
  trade-off is documented at the top of `nextjs-routes.ts`: auth enforced
  only in middleware or an imported wrapper reads as a false negative, by
  design, because a false positive on every route is worse.

## 0.12.0 — 2026-09-22

The static RLS and Storage ACL analyzers now run on the headline
`kelp scan <path>` command, not just the MCP surface. They shipped in
0.9.0 and 0.10.0 but for two releases only the MCP tools called them, so
`kelp scan` silently dropped six checks it was fully capable of running.
This closes that gap. Same parse of `supabase/migrations/*.sql`, no extra
cost, no new dependency.

### Added

- `kelp scan` now surfaces the six static schema checks in its normal
  output, JSON (`--json`), and written reports (`--report`):
  - RLS: `fk_leak_to_unprotected`, `command_scope_gap`, `view_bypasses_rls`.
  - Storage: `storage_public_bucket`, `storage_policy_missing_user_scope`,
    `storage_policy_permissive`.
- New `RLS-DEEP` row in the CHECKS section of the report, with the same
  applicable / n/a treatment as the other checks (n/a when the target has
  no SQL migrations).
- JSON output gained `checks.rlsSchema` and `checks.storageAcl` blocks,
  each with `applicable` and a finding count.
- Targeted remediation copy for all six rule ids in the HTML / Markdown
  report writer, instead of the generic fallback hint.
- Two integration tests that spawn the CLI over a fixture migration and
  assert the schema findings reach the JSON output, so the wiring can't
  rot back to MCP-only again. Total CLI test count: 36.

### Changed

- `kelp list-rules` moves RLS out of the "hosted app only" section. It
  now lists `RLS-DEEP` and `STORAGE` as static checks that run today, and
  keeps the live probe under a clearer "confirms at runtime what the
  static checks flag" label.
- `kelp explain` describes the SQL analyzer as part of the static engine.

### Notes

- Schema findings have no file:line, so the location is the schema object
  they live in: `schema.table` for RLS, `storage.buckets/<id>` or
  `storage.objects` for storage. RLS deep findings are marked
  `confidence: medium`.

## 0.11.0 — 2026-09-22

Multi-specialist agent squad. When you pass `--squad`, `kelp scan --agent`
splits into three focused specialists that run in parallel, each with its
own budget slice and system prompt, and a reviewer pass verifies the
merged findings before returning. This is behind a flag on purpose:
single-loop is still the default while people try the squad in the wild.

### Added

- **`--squad`** (opt-in, beta). Runs three focused specialists in parallel:
  - `secrets` (25% of the budget): hardcoded API keys, tokens, JWTs,
    private keys, provider credentials.
  - `auth-routes` (40% of the budget): Next.js `app/**/route.ts`,
    `app/**/actions.ts`, and legacy `pages/api/**/*` handlers that
    read or write without an auth check.
  - `rls-edge` (35% of the budget): Supabase edge functions and
    security-definer functions in classes the static analyzer can't
    catch (client-trusted user ids, service-role literals inside edge
    fns, open-proxy patterns, security-definer grants to anon).
- **Reviewer pass** (10% reserve of the total budget, no LLM cost).
  Reads each finding's cited file locally and drops any finding whose
  `source_contains` substring isn't present. Belt-and-braces on top of
  the per-specialist evidence gate.
- **`AgentDriver` + `DriverFactory` interfaces** in `agent/loop.ts` so
  the loop can be run with an injected driver. Enables full unit tests
  of the squad without a real Anthropic key.
- 5 new unit tests for the squad orchestrator, all offline via a mock
  driver. Total CLI test count: 34.

### Notes

- Cost math: `--squad` respects the same `--depth` budget as single
  loop. On `--depth standard` ($1 cap), each specialist gets ~$0.30 and
  the reviewer reserve is $0.10.
- Wall-clock: specialists run in `Promise.all`, so a squad run is close
  to the runtime of the slowest specialist rather than the sum.
- When a specialist crashes, the others keep going. The failure surfaces
  on that specialist's outcome as `specialist-error: ...`.
- Squad is off by default. When we have real-world data showing it beats
  single loop consistently, it'll be promoted to default.

## 0.10.0 — 2026-09-21

Static Supabase Storage ACL analyzer. Third pillar of the Supabase
static scan (after RLS and edge functions). Runs on the same
`supabase/migrations/*.sql` parse that landed in 0.9.0, so no extra
cost on scans.

### Added

- **`storage_public_bucket`** (high). Fires on any bucket created with
  `public = true`. Sometimes intentional (marketing assets), often an
  accidental leak of user documents / avatars / attachments.
- **`storage_policy_missing_user_scope`** (high). Fires on policies over
  `storage.objects` that filter by `bucket_id = 'X'` but never reference
  `auth.uid()`, `owner`, or `auth.jwt()`. All authenticated users can
  read/write every file in that bucket, one of the most common Supabase
  tutorial-copy mistakes.
- **`storage_policy_permissive`** (critical). Fires on
  `USING (true)` / `WITH CHECK (true)` policies on `storage.objects`
  for a client-facing role (anon, authenticated, public). Any caller
  reaches every file, ignoring bucket and owner.
- MCP `scan_path` / `scan_snippet` surface these findings under the
  `rls` class, and `list_rules` / `explain_rule` return the specs.

### Improvements

- The migration parser now auto-creates a phantom TableInfo for policies
  that target Supabase built-in tables never `CREATE TABLE`d in user
  migrations (storage.objects, auth.users, storage.buckets). Fixes
  silent drops of legitimate `CREATE POLICY ON storage.objects` blocks.
- 12 new VULN/CONTROL test pairs; total core test count now 93.

## 0.9.0 — 2026-09-21

Static RLS analyzer that reads the SQL migrations in a Supabase repo and
finds the misconfigurations vibe-coders reliably introduce. This is the
first version where `kelp scan` (and `kelp mcp`) has real coverage on
Row Level Security without needing a live database connection.

### Added

- **Static RLS engine over `supabase/migrations/*.sql`**. Parses
  `CREATE TABLE`, `CREATE POLICY`, `ALTER TABLE ... ENABLE ROW LEVEL
  SECURITY`, `GRANT`, `CREATE VIEW`, and inline + `ALTER` foreign keys
  into a schema graph, then runs seven rules over it.
- **Four base RLS rules** (already existed for the live path in
  `@kelp/core`, now fire on repo scans too):
  - `rls_disabled` (critical): table in the `public` schema with RLS off.
  - `permissive_policy` (critical): `USING (true)` on a table with an
    ownership column.
  - `owner_not_scoped` (high): ownership column present but no policy
    references `auth.uid()`.
  - `rls_no_policies` (low): RLS enabled but no client policies.
- **Three new deep rules** that require the schema graph:
  - `fk_leak_to_unprotected` (high): protected parent has a foreign key
    to a target with RLS off. PostgREST embeds leak the target through
    the FK.
  - `command_scope_gap` (high): SELECT policy plus write grants for
    anon/authenticated with no INSERT/UPDATE/DELETE policy. Reads safe,
    writes wide open.
  - `view_bypasses_rls` (high): `CREATE VIEW` over an RLS-protected base
    without `WITH (security_invoker = true)`. Silent RLS bypass.
- The MCP `scan_path` and `scan_snippet` tools now surface these
  findings under the `rls` class, and the MCP `list_rules` /
  `explain_rule` / `explain_finding` tools return the new rule specs.

### Notes

- Fully offline. Never needs a Supabase Management API token or a live
  database. Parser is regex-based and tuned to the shapes real Supabase
  migrations take (`supabase db diff`, dashboard exports, dbmate/prisma
  outputs).
- 13 VULN/CONTROL test pairs cover the parser and every rule.

## 0.8.0 — 2026-09-20

`kelp mcp` ships. The CLI now doubles as an MCP server for LLM clients
(Claude Code, Claude Desktop, Cursor, any MCP-compatible client) so an AI
assistant can call Kelp mid-conversation while generating code, instead of
scanning after the fact.

### Added

- **`kelp mcp` subcommand.** Starts a Model Context Protocol server on
  stdio (protocol version 2025-06-18). Five tools, two resources, two
  slash-command prompts. Everything runs locally, offline. No file content
  ever leaves the machine.
- **Tools**: `scan_path`, `scan_snippet`, `list_rules`, `explain_finding`,
  `explain_rule`. All return both a short text summary for the model and
  a fully structured JSON payload for programmatic consumers.
- **Resources**: `kelp://rules` (full catalog) and `kelp://rules/{ruleId}`
  (per-rule spec). Read-only, JSON.
- **Prompts (surface as slash commands)**: `/kelp:review-repo` and
  `/kelp:harden-file`. Give MCP-aware clients native entry points.
- **`docs/MCP.md`** with install snippets for Claude Code, Claude Desktop,
  Cursor, and any MCP-compatible client.

### Notes

- The paid `--agent` scan is intentionally NOT exposed via MCP yet.
  Wrapping a paid, agentic path as an MCP tool without a hard budget is a
  footgun. Reserved for a v2.
- New runtime dependency: `@modelcontextprotocol/sdk`. Externalized in the
  esbuild bundle so npm resolves it at install time.
- Bundle base size for the CLI grows because the MCP SDK is externalized:
  `dist/index.js` stays around ~40 KB gzipped; the SDK is installed
  separately.

## 0.7.0 — 2026-09-19

Two more community contributions from @maskjelly, plus one new finding
type, so the minor bumps again.

- **Stripe webhook signing secret detection** (@maskjelly, #75, closes
  #66). Recognizes `whsec_...` webhook signing secrets as `high`
  findings with Stripe attribution. A leaked webhook secret lets anyone
  forge signed payloads and pass the receiving service's "is this really
  from Stripe" check, so this is worth catching alongside the existing
  Stripe API key rules. The client-side severity bump lifts it to
  `critical` if the value ends up in a shipped bundle.
- **CLI honors `NO_COLOR` everywhere and adds `--no-color`** (@maskjelly,
  #73, closes #68). Color decision now lives in one `colorEnabled()` in
  `apps/cli/src/ui/style.ts` with a clear precedence: `--no-color`
  wins, then `NO_COLOR` (any non-empty value), then non-TTY stdout. Every
  ANSI helper gates on it, so escapes no longer leak into CI logs or
  piped output. `--json` output stays ANSI-free.
- CI change from the same PR: `apps/cli` unit tests now run in the
  GitHub Actions job alongside `@kelp/core` and `@kelp/worker` tests.
  Regressions on the walker or the color logic will fail CI going
  forward.

## 0.6.0 — 2026-09-10

Two new secret rules, both community contributions. Bumping the minor
because these introduce new finding types that downstream tooling (JSON
output consumers, PR gates) may want to react to differently.

- **Anthropic API keys** are now detected as critical findings (@be-student,
  #53, closes #48). Covers current `sk-ant-api03-…` and legacy `sk-ant-…`
  shapes with an 80-char body floor. Also fixes an existing bug where these
  values were being mis-classified as `openai-key`.
- **OpenAI project-scoped keys** get their own dedicated rule at critical
  severity (@MayurK-cmd, #55, closes #49). Classic `sk-…` still fires as
  `openai-key` (high), the new `sk-proj-…` shape fires as `openai-project-key`
  (critical), and the two never fire twice on the same value.
- **Fix**: `kelp --version` was reporting `0.5.0` on 0.5.1 and 0.5.2 too
  because the constant in `src/index.ts` was not bumped alongside
  `package.json`. Now sourced correctly for 0.6.0.

## 0.5.2 — 2026-09-06

- **Honor `.gitignore` when walking the target** (thanks @dasepmoch, #52,
  closes #50). Root and nested `.gitignore` files are now respected, with
  `!pattern` negation. On by default. Same result you'd get from `git ls-files`
  as the input to the scanner.

## 0.5.1 — 2026-09-02

- Publish hygiene: the tarball for 0.5.0 accidentally shipped every
  `.d.ts` + `.js.map` from the type-check (75 files, 200 KB). 0.5.1 is
  the same code, packed to just the esbuild bundle (4 files, 76 KB).
  Functionally identical — upgrade only if you care about disk.

## 0.5.0 — 2026-09-02

**Discoverability**

- `kelp explain` — the full manual on one screen. Depth trade-offs, focus
  classes, the safety model (evidence-gating, redacted transcript, no
  telemetry), cost expectations, examples. This is now the "read this
  first" page.
- `kelp scan --help` — subcommand-scoped help with only the scan flags,
  instead of the everything-help dump.
- First-run hint — if no `ANTHROPIC_API_KEY` is set, a single line points
  the user at `kelp explain` before the scan output.

**Reports**

- `--report <file>` writes a full report to disk. Extension picks the
  format: `.html` is styled (Fraunces/Inter Tight/JetBrains Mono, light +
  dark), opens with double-click; `.md` is a paste-into-a-PR-description
  Markdown. Both include per-finding remediation hints, agent run summary,
  and observations (when `--observations` was passed).

**Agent transparency**

- Coverage report — the agent run summary now shows how many files the
  agent actually read, how many greps it ran, how many directories it
  listed. Makes it obvious when a scan finished suspiciously fast.

## 0.4.0 — 2026-09-01

**Critical fix**

- Tool-result contents no longer leak into the CLI transcript. Previous
  versions of the agent mode printed truncated `read_file` output directly
  to stderr, which meant `.env` files (and any real secrets in them) could
  end up in a saved log. The renderer now emits a safe summary
  (`read_file → 2.1 KB`, `grep → 4 matches`, `list_files → 87 files`). The
  model still receives the full content — only the human-facing renderer
  is redacted. **Upgrade immediately if you ran 0.3.0 against a real
  project.**

**New**

- `--depth <preset>` picks model + cost cap + iteration cap together:
  `quick` (haiku, $0.15, 10), `standard` (sonnet, $1.00, 24, default),
  `thorough` (sonnet, $3.00, 40), `paranoid` (opus, $10.00, 80).
- `--focus <classes>` narrows the agent to specific classes:
  `secrets`, `auth`, `rls`, `edge-fn`, `redirects`. Comma-separated.
- `--observations` surfaces the agent's soft hints (things it noticed but
  couldn't cite evidence for) as a separate section, not as findings.
- `--dry-run` shows what would be scanned and the worst-case cost without
  calling the Anthropic API.
- `--no-static` skips the static checks (agent-only run).
- `--static-only` is now explicit (default when `--agent` is not passed).
- Agent findings are now part of the final report, with the same severity
  chips and file:line layout as static findings, plus a run-summary block
  (model, iterations, cost, duration, aborted reason if any).

**Prompt tuning**

- The agent system prompt now demands finding-first behaviour: any
  concrete evidence must be filed via `report_finding` immediately, before
  exploring further. Prior versions could hit the cost cap after
  identifying real vulnerabilities but before calling the reporting tool.

## 0.3.0 — 2026-09-01

- First multi-agent scan (`--agent`). Deprecated in favour of 0.4.0 due
  to the tool-result leak described above.

## 0.2.2 — 2026-08-31

- Transparent static scan: prints every check that ran + every check that
  was skipped because it needs a live target.

## 0.2.1 — 2026-08-31

- Bundle `@kelp/core` with esbuild so `npm i -g @kelp-security/cli` works
  without pulling a workspace-only package.

## 0.2.0 — 2026-08-31

- First public release on npm.
