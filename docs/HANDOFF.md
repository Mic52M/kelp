# Kelp — Project Handoff & Context

> Read this first. It is the single source of truth for a new contributor (human
> or a fresh Claude session) to understand what Kelp is, where it stands, and how
> to continue. Repo: `github.com/Mic52M/kelp` (private). Last updated: 2026-07-07.
>
> **For the multi-agent engine specifically** (Layer-by-layer architecture, the
> load-bearing invariant, how to add a new specialist, verify commands): read
> [`docs/AGENT-FRAMEWORK.md`](./AGENT-FRAMEWORK.md). It's the authoritative doc
> for that subsystem; this file gives you the product/business context around it.

---

## 1. What Kelp is (one line)

**Kelp is a self-serve security agent for "vibe-coded" apps** — apps built with
Lovable, Bolt.new, Replit, Cursor or v0 on a Supabase backend. It scans a
connected project, finds the security holes these tools routinely ship (missing
RLS, exposed secrets, broken object-level authorization), and hands the user a
ready-to-apply fix. Target user: the solo founder / small agency with **no
security background**, self-serve, value in under 10 minutes.

## 2. North star & strategy (READ — this guides every decision)

Kelp is being built as a **fundable, acquirable, venture-scale startup**, not a
side project. Every product/technical choice optimizes for that.

- **Positioning:** *"XBOW (xbow.com) for vibe-coded apps"* — agentic AI security
  testing, but scoped to the AI-generated-app attack surface, self-serve, and
  **fix-first**. We ride the vibe-coding wave (huge, new, no incumbent born for it).
- **Business model: PLG (product-led growth).** A free first scan is the viral
  top-of-funnel (the "aha moment"), then paid continuous scanning + auto-fix, then
  expansion as the user's app grows into a team/org. Freemium is the *funnel*, not
  charity. (Sentry/Snyk/Vercel model.)
- **Differentiator vs XBOW — the "fix-prompt" wedge:** our users built with AI
  tools, so the most natural fix is a **ready-to-paste prompt for their AI coding
  tool** (Cursor/Lovable/Bolt), not a git diff. This is built and working.
- **Data moat (future):** aggregate vulnerability intelligence across the
  vibe-coding ecosystem → proprietary detection + a "State of Vibe-Coding Security"
  report for PR/lead-gen.
- **Likely acquirers:** Supabase, Vercel, GitHub/Microsoft, Lovable/Bolt, Snyk,
  Semgrep, Wiz. Deep platform integrations increase acquisition surface.
- **Aesthetic north star: Resend (resend.com).** Clean, refined, generous
  whitespace, restrained motion, one accent. The current UI is a good *draft* but
  a dedicated Resend-grade design pass is still owed (new components are already
  built in that register — e.g. `ScanningView`). **Never** the "2015 bootstrap
  security dashboard" look.
- **Honesty rule:** never claim 100% coverage. We cover specific vulnerability
  **classes** with high precision.

## 3. Target user (for every UX decision)

Solo founder or 2–3 person team who shipped an app with Lovable/Bolt/Replit/
Cursor + Supabase, has ~zero security knowledge, has real users (risk is not
theoretical), wants "3 problems found, here's the fix, one click" — not a 40-page
report. Tone: reassuring and concrete, never alarmist or jargony. Treat the tester
as a **demanding/nitpicky premium user** — every button must work and feel
polished.

## 4. Product scope

**Vulnerability classes (priority order):**
1. **RLS** (Row Level Security) missing/misconfigured on Supabase — DONE (scanner
   + fix migration generator).
2. **Exposed secrets** in the GitHub repo — DONE (scanner + fix-prompt + real
   fix-PR creation, verified live — issue #3 closed).
3. **BOLA** (broken object-level authorization) — active testing. Deterministic
   probe + agentic engine (Claude plans, deterministic executor runs) are BUILT
   and tested with mocks; the real live tester needs user test accounts (issue #9).
4. Weak auth — stretch / later.

**Legal constraints (encoded in code, not just ToS):**
- Active (BOLA) testing runs ONLY through the consent gate
  (`packages/core/src/consent.ts` → `runWithActiveTestConsent`). No consent → no
  BOLA. This is the single chokepoint.
- Never test arbitrary third-party URLs — only OAuth-connected, authorized projects.
- End-user PII is stored/shown only as **category + count**, never raw values
  (`finding_exposure_summary` table).
- Every access to customer data writes to `audit_log`.
- Customer credentials are encrypted at rest (AES-256-GCM).

## 5. Architecture

Monorepo (npm workspaces). `apps/web` on Vercel, `apps/worker` on Railway/Fly
(decided). Multi-tenant from day one (org_id + RLS on our own Postgres).

```
apps/
  web/      Next.js 15 (App Router, React 19, Tailwind v4). Dark premium UI.
            - Auth (Supabase Auth email/password), middleware-gated routes.
            - Dashboard, onboarding (connect flow), findings/projects/settings/billing.
            - Server actions call the worker's engine API (@kelp/worker) + process
              scans in the background via next/server after() so it works with just
              the web running locally.
  worker/   Scan engine + connectors (@kelp/worker). Node/TS.
            - Real GitHub connector (App installation; downloads repo TARBALL in 1
              request — see connectors/github.ts).
            - Real Supabase connector (Management API → schema/RLS).
            - Anthropic reasoning layer (llm/anthropic.ts) + agentic BOLA driver.
            - db.ts (pg, privileged/bypass-RLS), scan-processor.ts, api.ts (web-facing).
            - index.ts also runs as a persistent poll loop (production worker).
packages/
  core/     Framework-agnostic domain logic (@kelp/core), 55 unit tests, all green.
            - Scanners: scanners/secrets.ts, scanners/rls.ts (+ migration generator).
            - Consent guard, crypto (AES-256-GCM), fingerprint.
            - Remediation: secret-pr.ts, bola-report.ts, fix-prompt.ts (the wedge).
            - Orchestrator (runScan) + agent loop (agent/loop.ts, agent/bola.ts).
  db/       SQL schema + migrations (source of truth) + migrate.ts runner.
            0001_init.sql (multi-tenant schema), 0002_rls_policies.sql.
```

**Deterministic vs LLM (important principle):** scanners are deterministic (regex,
schema analysis) so results are reproducible and low-false-positive. Claude sits
*on top* — explanations, planning the agentic BOLA test, fix-prompts — and **never
decides on its own whether a finding is real** (the agentic executor refuses to
record a BOLA finding unless a real probe confirmed it).

## 6. What's built and VERIFIED (on real data unless noted)

- ✅ **Multi-tenant schema + RLS** applied to our Supabase (12 tables, RLS policies).
- ✅ **Secret scanner** — provider patterns, Supabase service_role vs anon (anon is
  public, correctly ignored), client-side severity bump, entropy fallback. Values
  masked. Validated on real repos; caught & fixed 2 false positives.
- ✅ **RLS analyzer** — flags RLS-off, permissive `USING(true)` (only for
  client-facing roles — service_role bypass policies correctly ignored), unscoped
  ownership. Generates review-before-apply `CREATE POLICY` migration. Validated on a
  real Supabase project.
- ✅ **Fast repo read** — downloads the GitHub tarball in ONE request (~2s for a
  full scan; was ~45s / rate-limited with per-blob fetching).
- ✅ **Agentic BOLA engine** — Claude drives deterministic probes; verified live
  against a mock target (lists endpoints, probes, reports only confirmed leaks).
- ✅ **Anthropic reasoning** — plain-language explanations (Haiku), two-model config
  (Opus 4.8 reasoning + Haiku 4.5 volume). Verified live.
- ✅ **Fix-prompt generator** — paste-ready prompts for Lovable/Bolt/Cursor/v0.
- ✅ **Auth** — Supabase Auth (email/password), tenant bootstrap (user/org/
  membership on first login). Verified end-to-end (browser + DB).
- ✅ **Connect flow** — onboarding: pick a GitHub repo, pick a Supabase project
  (from a pasted Management token), run scan. Verified live.
- ✅ **Multi-user GitHub install (issue #14)** — users install the Kelp App on their
  own account/org via a signed-`state` redirect; the post-install callback
  (`/api/github/setup`) verifies the HMAC state + org membership and stores the
  installation per org (`github_installations` table, migration 0003). Repo listing
  is now per-org (`listReposForOrg`, aggregates across an org's installations,
  carries each repo's installation id through connect) instead of a single env
  installation. Env `GITHUB_APP_INSTALLATION_ID` is now a dev-only fallback.
  **Requires** the GitHub App "Setup URL" → `<APP_URL>/api/github/setup`. Verified
  live: per-org listing (40 real repos), connect stores the right installation,
  scan succeeds; install URL resolves to the real app slug; state HMAC round-trip
  rejects expired/tampered/forged tokens.
- ✅ **Scan pipeline** — enqueue → process (via after() locally, or worker poll loop)
  → findings persisted (upsert by fingerprint) → dashboard shows real, RLS-scoped
  data. Verified live.
- ✅ **Async scan + live status** — Resend-style `ScanningView` (radar + phased
  checklist + shimmer) while scanning; old findings hidden; auto-refresh swaps in
  results. Verified live.
- ✅ **Real fix PRs for secrets** — "Open fix PR" on a secret finding creates a
  `kelp/*` branch, replaces the hard-coded value with `process.env.X` (edit built
  deterministically in core, refuses partial fixes so the value can never survive),
  opens the PR against the default branch, records the remediation + audit row and
  moves the finding to `pr_opened`. Idempotent (re-click returns the same PR).
  Verified live: https://github.com/Mic52M/luneai/pull/3.
- ✅ **Dashboard fully navigable** — sidebar (Overview/Findings/Projects/Settings),
  Billing (Upgrade), per-project re-scan, **Reconnect Supabase token** (Settings),
  finding **Copy prompt** (computed for real findings) + **Dismiss** (functional).
  Scan errors surfaced as calm banners (e.g. rejected Supabase token → "reconnect").
- ✅ **Redis-backed scan queue (#7)** — BullMQ delivery replaces the in-process
  poll loop for production. `apps/worker/src/redis-queue.ts` + `index.ts` bootstraps
  a worker consuming `scans` jobs; the web app enqueues via the same queue when
  `REDIS_URL` is set (falls back to `after()` locally). Idempotent by `scan_id`.
- ✅ **Stripe billing scaffolding (#10)** — `apps/worker/src/stripe.ts` +
  `/api/billing/checkout` + `/api/billing/webhook`. Signed webhook verification,
  plan tier flipped on `checkout.session.completed` / `customer.subscription.*`.
  `UpgradeButton.tsx` triggers hosted checkout from the dashboard.
- ✅ **PLG free-plan gating (#17)** — `packages/core/src/plans.ts` owns tier
  limits (scans/mo, projects, active-pentest access). Enforced server-side in
  scan enqueue + orchestrator entry; over-limit returns a calm 402 banner instead
  of crashing. Free = 1 project / N scans / no active pentest.
- ✅ **Supabase per-project read-only role (#5)** — replaces the account-level
  Management PAT for scans. `apps/worker/src/connectors/supabase-pg.ts` connects
  as a least-privilege role provisioned per project; `SupabaseReadonlyForm.tsx`
  walks the user through creating it. Old PAT path retained as fallback.
- ✅ **Consent v2 (#24)** — `packages/core/src/consent.ts` exports
  `CONSENT_ACCEPTED_FOR_MULTI_SPECIALIST = ["v2"]` vs
  `CONSENT_ACCEPTED_FOR_BOLA_ONLY = ["v1","v2"]`; multi-specialist campaigns
  require v2. Full copy + toggle in `ActiveTestingConsentForm.tsx` (dashboard
  settings). Legacy v1 acceptances stay valid for single-specialist BOLA.
- ✅ **Cost accounting (#25)** — `packages/core/src/agent/pricing.ts` prices
  Opus 4.7/4.8, Sonnet 5, Haiku 4.5 by longest-prefix match on model id.
  Anthropic driver reports `LlmUsage`; orchestrator attaches `SpecialistUsage`
  (tokens + `estimatedCostUsd`) to every outcome and a `totalUsage` on the
  campaign. Persisted per scan in `scans.cost_cents` (migration `0007`).
- ✅ **Live-Anthropic verify variants (#26)** — one `verify-<name>-target-live.ts`
  per specialist, gated by `KELP_ANTHROPIC_LIVE=1`. Shared harness in
  `apps/worker/src/agent/live-verify.ts`. `npm run verify:live -w @kelp/worker`
  chains all seven; each burns real tokens against `localhost:4400` and prints
  cost. Gate absent → skips (never fails CI by default).

## 7. Credentials & environment (NOT in the repo)

Secrets live in `.env.local` (repo root) and a copy in `apps/web/.env.local`
(Next reads the app-local one). Both are gitignored. The user provides tokens via a
secure terminal pattern (`read -rs ... >> .env.local`) so secrets never hit chat.

Keys currently set (owned by the user, `Mic52M`):
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` — our app's Supabase project (DB + Auth).
- `DATABASE_URL` — same Supabase Postgres (worker connects with a privileged role).
- `KELP_CREDENTIAL_ENC_KEY` — 32-byte base64, encrypts customer creds at rest.
- `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`,
  `GITHUB_APP_PRIVATE_KEY_BASE64`, `GITHUB_APP_INSTALLATION_ID` — the "Kelp Dev"
  GitHub App on the user's account. **Client secret & private key were pasted in an
  earlier chat → rotate before production (issue #1).**
- `SUPABASE_MANAGEMENT_TOKEN` — the user's Supabase Management API token (used for
  local testing / seed scripts).
- `ANTHROPIC_API_KEY`, plus `ANTHROPIC_MODEL_REASONING=claude-opus-4-8`,
  `ANTHROPIC_MODEL_CHEAP=claude-haiku-4-5`.

See `.env.example` for the full list. When a new key is needed, ask the user to
add it with the secure `read -rs` pattern; then copy the needed subset into
`apps/web/.env.local`.

## 8. How to run locally

```bash
npm install
# Apply DB migrations once (against DATABASE_URL):
node --env-file=.env.local packages/db/src/migrate.ts
# Run everything (web on :3000 + worker poll loop):
npm run dev
# ...or just the web (scans still run via after()):
npm run dev --workspace @kelp/web
# Tests (core):
npm test
```

**Test account:** `founder+demo@kelp.dev` / `Test12345!` (has projects `luneai` and
`auto-spark-flows` with real findings). Note: the app's dev server hardcodes port
3000; a preview-only alt config runs on 3010 (`dev:alt`).

Useful scripts (worker, run with `--env-file=.env.local`):
`apps/worker/dist/scan-github.js <owner/repo>`, `.../scan-supabase.js <ref>`,
`.../agent-demo.js`, `.../seed-scan.js`, `.../verify-llm.js`.

## 9. Key technical decisions

- Supabase Auth (not Clerk) — RLS policies use `auth.uid()`.
- Multi-tenant from day one (org_id + RLS on our Postgres).
- BOLA test accounts: user provides them (we don't create users in their app).
- Local scans run via Next `after()` (no separate worker needed); production uses
  the worker poll loop + a real queue (issue #7).
- Next 15 pinned to a patched version (past CVE-2025-66478); Tailwind v4.
- Scan engine kept out of the Next bundle via `serverExternalPackages`.

## 10. What's next — prioritized backlog (see GitHub issues)

**Every open issue now has a "Execution context for a fresh Claude Code session"
comment** with file pointers, approach and a verification step — a new session can
pick any issue and run it. Recent work this cycle (all shipped, closed): #5
Supabase read-only role, #7 Redis queue, #10 Stripe, #17 plan gating, #24
consent v2, #25 cost accounting, #26 live-Anthropic verify. Multi-agent phase 2 +
phase 3 both done — the moat is complete engine-side; the remaining gap is
wiring it into the customer scan path (#27).

Suggested order toward **production-ready, self-serve** (the current north star):

1. **#27 (MVP shipped, follow-up open)** orchestrator wired into the customer
   scan path — migration `0008` (`projects.app_base_url`, `scans.mode`),
   customer-backends factory, `executeActivePentestScan` branch, dashboard
   "Run active pen test" button + consent v2 + config forms + per-specialist
   progress rows, `verify:campaign-e2e`. **Follow-up: real endpoint discovery**
   from the connected repo + Supabase schema (MVP reuses the test-target
   endpoint shape parameterized by `app_base_url` — customers whose app
   matches that shape get real findings today; others get zero).
2. **#1** rotate GitHub App secret + private key — security, blocking prod, small.
3. **#2** make the GitHub App public + dedicated org — unblocks true multi-user
   install (pairs with the closed #14).
4. **#13** Resend-grade design pass — do after the endpoint-discovery follow-up.
5. **#16** production deploy (Vercel + Railway/Fly) — after #1/#2.
6. **#19** parent tracker — closes once #27's follow-up (real endpoint discovery) ships.

## 11z. Multi-agent pen-testing framework (post-#19 phase 1)

Foundation for the "XBOW-for-vibe-code" moat is now shipped:

- `packages/core/src/agent/specialist.ts` — `Specialist<Backend, Finding>`
  interface. Each specialist declares its name, `vulnClass`, system prompt,
  tools, initial prompt, and — critically — a `createExecutor` that OWNS the
  "no confirmed evidence = no finding" invariant. The model cannot fabricate.
- `packages/core/src/agent/specialists/bola.ts` — BOLA migrated as the first
  specialist. Same behavior, same tests pass, but now plugs into the shared
  orchestrator alongside future specialists (auth, injection, SSRF, RLS-deep,
  exposure, weak crypto).
- `packages/core/src/agent/orchestrator.ts` — `runActivePentest`, the
  consent-gated entry point for a multi-specialist campaign. Dispatches N
  specialists in parallel (bounded by `maxParallel`), each with its own
  driver + backend. Aggregates confirmed findings, preserves caller-provided
  ordering in the outcome list, isolates specialist crashes (one blowing up
  doesn't kill the campaign). `runCampaignUnsafe` skips the consent gate —
  unit tests only.
- `packages/core/src/agent/bola.ts` — legacy `runBolaAgent` now delegates to
  the orchestrator with a single-specialist campaign, so existing worker
  call sites and tests keep working unchanged.

Verified: 70/70 core tests pass (63 pre-existing + 7 new orchestrator).
Coverage includes dispatch, aggregation, invariant enforcement,
crash-isolation, consent gating, `maxParallel` bound, order preservation.

**Test target app** (`apps/test-target`) — deliberately-vulnerable Express app
with ground-truth-known flaws: `GET /api/orders/:id` (BOLA-vulnerable), `GET
/api/profiles/:id` (secure control), `GET /api/session-lookup?as=…`
(auth-bypass). Never deploy outside localhost. See `apps/test-target/README.md`
for the ground-truth table and sanity-check curl commands. Boot with `npm run
dev -w @kelp/test-target` → `:4400`.

**Validation** — every specialist ships with a `verify:<name>-target` npm
script that runs one campaign against the running target and asserts the
ground-truth outcome:
 · `npm run verify:bola-target -w @kelp/worker` — asserts `/api/orders/:id`
   IS flagged and `/api/profiles/:id` is NOT (no false positive)
 · `npm run verify:auth-bypass-target -w @kelp/worker` — asserts
   `/api/session-lookup` IS flagged via `query_as_param` and `/api/me` is NOT
Every new specialist added in phase 2 must add its own verify script before
being enabled in the customer path.

**Second specialist (auth-bypass) — proof the framework generalizes.**
Added `packages/core/src/agent/specialists/auth-bypass.ts` with four known
impersonation techniques (`query_as_param`, `x_user_header`,
`userid_body_override`, `token_swap`) and the same load-bearing invariant
(no confirmed probe → no finding). Adding this specialist required zero
changes to the framework core, orchestrator, or consent gate — the whole
scaffold from phase 1 held up under a real-world second class.

**Third specialist (injection) — proof it holds under a radically
different pattern.** BOLA and auth-bypass both work by probing whether one
account can act as another; injection instead compares response counts
against a baseline as a small catalog of payloads is applied. Different
detection shape, same framework, same invariant. Added the `injection`
value to `VulnClass` (migration `0004_vuln_class_injection.sql`, applied)
and shipped `packages/core/src/agent/specialists/injection.ts`. The target
gained `/api/orders/search` (deliberately vulnerable: `' OR '1'='1--`
widens the WHERE) and `/api/orders/find` (parameterised control). `npm run
verify:injection-target -w @kelp/worker` confirms live: search flagged,
find clean, exit 0.

**Fourth specialist (SSRF) — out-of-band evidence pattern.** BOLA/auth/
injection all confirm via response inspection; SSRF requires *the target
actually made an outbound request*. The backend (`test-target-ssrf-backend.ts`)
spins up a local HTTP listener on a random port, feeds each probe URL
(five techniques: plain_http, loopback_127, loopback_localhost,
url_encoded_host, metadata_ip), waits for the callback to fire with a
matching one-time token, and treats a listener hit as unforgeable evidence.
Findings are per-technique (a fix for `127.0.0.1` may not cover `localhost`).
`injection` and `ssrf` were added to the enum via migrations 0004 and 0005;
both applied.

**Fifth specialist (data-exposure) — response-shape audit pattern.** Fifth
detection shape in the roster: no fuzzing, no cross-account, no out-of-band
callback — just audits the field NAMES of the response body (never values;
the backend's data-hygiene invariant is non-negotiable) against Kelp's
sensitive-terms dictionary (`password`, `password_hash`, `salt`,
`otp_secret`, `refresh_token`, `stripe_secret`, `private_key`, and their
naming-convention variants). The dictionary lives in the executor, not the
model: Kelp — never the LLM — decides what counts as sensitive. `exposure`
added to the enum via migration 0006 (applied).

**Sixth specialist (RLS-deep) — probe-based complement to the static
analyzer.** Complements the RLS analyzer (which reads `pg_policies` and
flags "no policy" / "USING(true)") with an ACTIVE variant that
authenticates as two test accounts and actually tries to read across
them. Reuses `vulnClass: "rls"` — same fix path as the static findings.
Uses the test target's mock DB endpoints (`/api/db/tables`,
`/api/db/select?table=…&owner=…`) as ground truth: `orders_public` (RLS
off) leaks, `orders_scoped` (RLS on) doesn't.

Total: **six specialists live end-to-end** with confirmed evidence and
zero false positives on the test target. 92/92 core tests green. Each
specialist demonstrates a different detection shape:
  · BOLA        → cross-account probe by resource id
  · Auth-bypass → impersonation techniques
  · Injection   → baseline vs payload result-set diff
  · SSRF        → out-of-band callback listener
  · Exposure    → response field-name audit
  · RLS-deep    → cross-account probe at the *table* level

**Seventh (last of phase 2) specialist — weak-crypto (cookie flags).**
Highest-signal, lowest-false-positive audit: inspects the `Set-Cookie`
header of each endpoint and flags cookies missing HttpOnly, Secure, or
SameSite. Kelp — never the model — holds the flag dictionary via the
executor; the backend's data-hygiene rule extends here too (cookie
values are never inspected). `auditSetCookie` in the core specialist
handles the parsing so any specialist can reuse it if needed. Reuses
`vulnClass: "auth"` — no enum churn.

**Phase 2 complete.** All seven planned specialists live end-to-end
against the deliberately-vulnerable test target:
  · BOLA        → cross-account probe by resource id
  · Auth-bypass → impersonation techniques
  · Injection   → baseline vs payload result-set diff
  · SSRF        → out-of-band callback listener
  · Exposure    → response field-name audit
  · RLS-deep    → cross-account probe at the *table* level
  · Weak-crypto → Set-Cookie flag audit

121/121 core tests green. All 7 `npm run verify:*-target -w @kelp/worker`
scripts exit 0 against the running test target, with zero false
positives on any control endpoint.

**Phase 3 complete** (issues #24, #25, #26 closed):
  · Consent v2 shipped — `CONSENT_ACCEPTED_FOR_MULTI_SPECIALIST` gates
    multi-specialist campaigns; v1 acceptances still valid for BOLA only.
    Copy + toggle live in `ActiveTestingConsentForm.tsx`.
  · Cost accounting shipped — `packages/core/src/agent/pricing.ts` prices
    every Anthropic call; orchestrator returns `SpecialistUsage` per
    specialist + `totalUsage` per campaign; persisted in `scans.cost_cents`
    (migration `0007`).
  · Live-Anthropic verify shipped — one `verify-<name>-target-live.ts` per
    specialist under `apps/worker/src/agent/`, shared harness in
    `live-verify.ts`, all seven chained by `npm run verify:live`. Gated by
    `KELP_ANTHROPIC_LIVE=1`.

**Customer path (#27 MVP shipped).** `runActivePentest` is now reachable
from the dashboard:
  · Migration `0008` adds `projects.app_base_url` and `scans.mode`
    (`passive` | `active_pentest`).
  · `executeActivePentestScan` in `apps/worker/src/scan-processor.ts`
    branches on `scans.mode`, gates on plan tier + consent v2 + monthly
    cost cap, dispatches the seven-specialist campaign via
    `buildCustomerCampaignEntries`, persists findings via the new
    `campaignFindingsToDetected` mapper and cost via `scans.cost_cents`.
  · Dashboard top-bar `ActivePentestButton` (paid tiers only, gated by
    plan + consent + app URL). New Settings section wires
    `app_base_url` + two encrypted `app_test_account_a/_b` credentials.
    `ScanningView` shows a seven-row per-specialist checklist when
    `mode === 'active_pentest'`.
  · `verify:campaign-e2e -w @kelp/worker` seeds a scratch org+project,
    runs one campaign through the full scan-processor path, asserts
    findings written + `cost_cents` populated. Gated by
    `KELP_ANTHROPIC_LIVE=1`.

**Follow-up (still open under #27):** the MVP customer backends re-use the
in-repo test-target endpoint shape parameterized by `app_base_url`, so a
customer whose deployed app matches that shape gets real findings today
and everyone else gets zero. Real endpoint discovery from the connected
repo (via `listSourceFiles`) + Supabase schema is the follow-up.

## 11a. Findings lifecycle (post-#15)

Every scan closes what it doesn't re-detect. After `upsertFindings` in
`apps/worker/src/scan-processor.ts`, `resolveMissingFindings` closes findings
whose `last_scan_id <> currentScanId` and status is in
(`open`, `pr_opened`, `regressed`). Scoped to project × **successfully-run**
vuln classes only (a class that errored doesn't get to resolve anything).
`needs_review` / `confirmed` / `dismissed` are left alone. Existing resolve→
regress on re-detection (`upsertFindings`) is unchanged.

## 11b. Webhook re-scan (post-#4)

`apps/web/app/api/github/webhook/route.ts` — GitHub push webhook. Verifies
`X-Hub-Signature-256` HMAC against `GITHUB_WEBHOOK_SECRET` (constant-time),
returns `ping` OK, ignores non-`push` events, non-default-branch pushes, and
pushes for repos not connected to a Kelp project. A matching push enqueues a
secret re-scan with `trigger='webhook_push'`. Requires the GitHub App's Webhook
URL set to `<APP_URL>/api/github/webhook` with the same secret and the `push`
event subscribed.

## 11c. GitHub install flow — how it works now (post-#14)

- `github_installations` table (org → installation_id), migration
  `packages/db/migrations/0003_github_installations.sql`, RLS-scoped, backfilled
  from projects that already had an installation.
- Onboarding "Install the Kelp GitHub App" → `startGithubInstallAction`
  (`apps/web/app/onboarding/actions.ts`) mints a signed HMAC `state` (org+expiry)
  and redirects to the App install URL (slug fetched via App JWT).
- Callback `apps/web/app/api/github/setup/route.ts` verifies state + org
  membership, then `registerGithubInstallation` stores it (account login/type via
  `GET /app/installations/{id}`).
- Repo listing is per-org: `listReposForOrg` (`apps/worker/src/api.ts`) aggregates
  across the org's installations; each repo carries its `installationId` through
  connect. `GITHUB_APP_INSTALLATION_ID` is now a **dev-only fallback** (empty in prod).
- **Requires** the GitHub App **Setup URL** = `<APP_URL>/api/github/setup`.

## 12. Working style the user prefers

- Ship real, verified functionality — verify in the browser/DB, not just "it builds".
- Be a candid co-founder: push back with reasoning, don't just agree.
- Premium bar on everything (the "nitpicky premium user" standard).
- Commit + push after each coherent slice; keep secrets out of the repo.
- The user moves fast ("light speed") but wants everything actually working.
