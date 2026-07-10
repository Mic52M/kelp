# Kelp — Project Handoff & Context

> Read this first. It is the single source of truth for a new contributor (human
> or a fresh Claude session) to understand what Kelp is, where it stands, and how
> to continue. Repo: `github.com/Mic52M/kelp` (private). Last updated: 2026-07-09.
>
> **For the multi-agent engine specifically** (Layer-by-layer architecture, the
> load-bearing invariant, how to add a new specialist, verify commands): read
> [`docs/AGENT-FRAMEWORK.md`](./AGENT-FRAMEWORK.md). It's the authoritative doc
> for that subsystem; this file gives you the product/business context around it.
>
> **BIG PIVOT (2026-07-08):** the scripted list→probe specialists were replaced
> by an **autonomous multi-agent squad** — real reasoning + attack + adapt loops
> over a shared toolbox, with a post-hoc reviewer that spawns focused follow-up
> agents on missed leads. This is Kelp's north star ("XBOW for vibe-code") made
> real. The scripted specialists still exist in-repo (customer-backends, edge-
> backends, supabase-native/*-backend.ts) but they are **not on the active-
> pentest path anymore**. Kept for test infrastructure and possible reuse as
> agent tools. See § 11 for the current engine, and `AGENT-FRAMEWORK.md`.

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
  core/     Framework-agnostic domain logic (@kelp/core), 155 unit tests, green.
            - Deterministic scanners: scanners/secrets.ts, scanners/rls.ts.
            - Consent guard (v1/v2/v3), crypto (AES-256-GCM), fingerprint.
            - Remediation: secret-pr.ts, bola-report.ts, fix-prompt.ts.
            - Autonomous pen-test engine: agent/autonomous.ts (PentestTools +
              executor + evidence gate), agent/reviewer.ts (post-hoc reviewer +
              follow-ups), agent/backend-brief.ts (deterministic pre-recon
              pack), agent/repo-recon.ts (detect Supabase config + schema/RLS
              from the repo — the Lovable Cloud unlock), agent/edge-functions.ts
              (edge-fn discovery + safety classification).
            - Legacy scripted specialists: agent/specialists/*.ts + agent/
              orchestrator.ts. NOT on the active-pentest path anymore — kept
              as test infra and possible agent tools.
  db/       SQL schema + migrations (source of truth) + migrate.ts runner.
            0001–0008 (multi-tenant + consent + cost accounting + active
            pentest), 0009 finding_feedback (false-positive loop), 0010
            scans.agent_report (persisted transcripts).
```

**Deterministic vs LLM (important principle):** the load-bearing invariant of
the whole product is "no fabrication". Everything the LLM says gets re-verified
by Kelp deterministically before it becomes a finding:

- Passive scanners (secrets, RLS-static) run without any LLM.
- The autonomous agents reason, form hypotheses and probe *freely*, but every
  `report_finding` call is gated by an executor that RE-RUNS the model's
  reproduction (probe or source citation) and only persists the finding if the
  expected observable actually holds. See `packages/core/src/agent/autonomous.ts`
  → `handleReport` + `confirm`.
- The reviewer (post-hoc) can spawn follow-up agents but cannot itself file
  findings — only queue leads. Follow-up findings still go through the same
  evidence gate.

The result: agents have real autonomy on the reasoning side, zero fabrication
on the results side. "We never claim 100% coverage — but what we report is real."

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
  cost. Gate absent → skips (never fails CI by default). Note these verify the
  *legacy* scripted specialists; the autonomous engine is verified via live
  runs against real customer projects (§ 11 below).
- ✅ **Autonomous multi-agent engine (48d100c)** — the north-star pivot. Three
  agents (`agent-data`, `agent-edge`, `agent-surface`) reason + attack + loop
  over their own attack surface with a shared toolbox (`PentestTools`). See § 11.
- ✅ **Repo-based Supabase detection (31c3438, f9da32e, 92ab60c)** — Lovable
  Cloud unlock. `detectSupabaseConfig` + `parseRepoSchema` read URL/anon key/
  schema/RLS from the connected repo, so a project with no DB access is fully
  scannable. Verified live on `usatopoint-test`.
- ✅ **Connect = repo-only + auto-filled Configuration (9516589)** — onboarding
  is a single step: pick a repo. No API-key prompt. Configuration is
  pre-populated from repo detection; only test-account credentials are asked.
- ✅ **Deterministic backend brief (463f4d8)** — RPC function bodies (SECURITY
  DEFINER flagged for search_path attacks), edge-fn signatures + verify_jwt
  state, injected into every agent's initial prompt. Cuts wasted "grep the
  repo" steps that the audit caught agent-data spending ~6/22 steps on.
- ✅ **Prompt caching in Anthropic driver (fc9a9ba)** — system + tools +
  conversation prefix cached ephemeral. Cost accounting reweights
  `cache_creation` × 1.25 and `cache_read` × 0.10 back into billable-equivalent
  input tokens so the estimated cost matches the real bill.
- ✅ **Agent transcript persistence (4b5ecc2, migration 0010)** — every
  active-pentest scan writes its full `CampaignReport` (per-agent name, steps,
  cost, transcript, findings, error) to `scans.agent_report jsonb`. Overview
  renders an "Agent report" panel per outcome with expandable transcripts —
  the trust surface for the "0 findings" case.
- ✅ **Post-hoc reviewer + follow-ups (2ecde17)** — one LLM call reads the
  squad's outcomes and queues up to 3 leads; each lead becomes a focused
  follow-up specialist (8-step budget, tight brief, same evidence gate).
  Verified live: on usatopoint-test, filed a genuine `newsletter_subscribers`
  RLS finding the primary squad hadn't converted.
- ✅ **Findings feedback loop (ad4c9ae, migration 0009)** — "Mark resolved"
  and "False positive" buttons. False-positive click writes to
  `finding_feedback` (vuln class, rule, location, fingerprint — never any
  secret value) for detector tuning. Begin of the data moat.
- ✅ **AuthModelBrief + exploitability gate (precision pass, 2026-07-09)** —
  the false-positive audit on usatopoint (Lovable refuted 4/5 findings) showed
  agents were confirming observables that didn't survive this app's auth
  model. Fix in `packages/core/src/agent/auth-model.ts`: deterministic
  derivation of `AuthModelBrief` from source files (Set-Cookie presence,
  `Access-Control-Allow-Credentials: true` presence, server-side price
  recalc hints, one-time-token table names). Brief's `narrative` injected at
  the TOP of every agent's system prompt as GROUND TRUTH, and
  `checkExploitability` runs after `confirm()` in `handleReport` as a
  deterministic second gate. Persona rewritten with explicit "impact chain
  first" section (attacker → victim → vector → gain) + named
  false-positive patterns (CSRF on bearer-JWT apps, wildcard CORS without
  Allow-Credentials, anon INSERT without downstream harm, verify_jwt=false
  on functions with internal auth). Triage receives the same brief and
  applies the same rules as a third defense. Verified offline:
  `npm run verify:auth-model -w @kelp/worker` reproduces all 4
  Lovable-refuted findings and asserts they're refused at the gate; the
  legitimate cross-account RLS finding + the anon INSERT WITH harm evidence
  pass through. 190/190 core unit tests green (+19 for auth-model).
- ✅ **Triage layer (#29)** — post-review LLM pass in `packages/core/src/agent/
  triage.ts` reads every confirmed finding and can `keep` / `downgrade_to_
  needs_review` / `reclassify` (vulnClass + severity, downward only) / `reject`
  before we persist. Enforced in code: never adds a finding, never upgrades
  severity (refused at the runner AND re-checked in the applier), crash-
  isolated (any failure returns the untouched report). `DetectedFinding.
  initialStatus` threaded through `campaignFindingsToDetected` →
  `upsertFindings` so downgraded findings land as `needs_review` on insert;
  reason string appended to `explanation` so the user sees WHY Kelp
  declassified. Triage cost is folded into `totalUsage` → `scans.cost_cents`.
  Verified offline via `npm run verify:triage -w @kelp/worker` (all 4
  actions + upgrade refusal + crash isolation + empty-input path); 171/171
  core unit tests green.
- ✅ **UX polish from live testing (3cf1458)** — auto-resolve disabled on
  active-pentest (agents are non-deterministic between runs); fix-prompt
  templates fixed to use the agent's `raw.fix` when present (was rendering
  "undefined … undefined" for reclassified findings); "Paste this to your AI
  coding assistant:" preamble removed; conditional "What to do" panel.
- ✅ **DB pool cap (6254c55)** — `KELP_DB_POOL_MAX=5` default. Supabase
  session pooler has 15 total connections; web(5) + worker(5) = 10 < 15 with
  headroom. In prod, prefer the transaction pooler (port 6543) which scales
  to far more connections.

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

**Every open issue has a "Execution context for a fresh Claude Code session"
comment** with file pointers, approach and a verification step. Recent big-ticket
work (all shipped, closed): #5 Supabase read-only role, #7 Redis queue, #10
Stripe, #17 plan gating, #24 consent v2, #25 cost accounting, #26 live-Anthropic
verify, #27 (MVP + Stage-A + Stage-B all done — customer scan path is live and
the endpoint-discovery follow-up shipped via Stage B).

**The engine is a genuinely working autonomous pen tester now.** Verified
end-to-end on `luneai` and `usatopoint-test` (both real Lovable projects). The
remaining backlog is about trust, cost, and product polish — not core capability.

Suggested order toward **production-ready, self-serve**:

1. ~~**#29** false-positive triage layer~~ — **shipped** (see § 6). Next slice
   on this thread is optional UI polish: a dedicated "Needs your judgment"
   section on Overview that surfaces `needs_review` findings + the triage
   reason inline. Cheap follow-up when we get to #13.
2. **#1** rotate GitHub App secret + private key — security, blocking prod, small.
3. **#2** make the GitHub App public + dedicated org — unblocks true multi-user
   install (pairs with the closed #14).
4. **#16** production deploy (Vercel + Railway/Fly) — after #1/#2. In prod, use
   the **transaction pooler** (port 6543) for `DATABASE_URL` — the current
   `KELP_DB_POOL_MAX=5` cap (see 6254c55) exists because the session pooler
   ships with only 15 server connections.
5. **#13** Resend-grade design pass — after #29 lands and results settle.
6. **#19** parent tracker — closable now (Stage-A + Stage-B both shipped; the
   engine has since evolved past the specialist model). Leave open only if you
   want it as a retrospective anchor.

**Open questions worth thinking about (not yet issues):**

- **Reviewer transparency.** The reviewer LLM picks up to 3 leads per scan but
  its reasoning + the specific hypothesis it queued aren't persisted separately —
  only the resulting follow-up outcome is. If Kelp scales, users will want to see
  *why* Kelp chased what it chased. Small extension to `agent_report`.
- **Cost visibility per user, not per scan.** `scans.cost_cents` is per-scan
  only. A monthly view of "your team's Claude spend" is table stakes for the
  paid tier.
- **Non-Supabase backends.** Lovable Cloud IS Supabase, Bolt/v0 ship on Supabase
  too. Firebase (via Firebase Studio) and Convex are the next credible
  alternatives. Not urgent — no target customers on those today — but the seam
  `BackendAdapter` was left implicit; if we need it, it's a real refactor.

## 11. Autonomous pen-test engine (current — the north-star)

**This section supersedes the old "seven scripted specialists" story.** The
scripted specialists still exist in `packages/core/src/agent/specialists/*.ts`
and their factories in `apps/worker/src/agent/{customer-backends,supabase-native,
edge-backends,test-target-*-backend}.ts`, but the active-pentest scan path no
longer uses them. They remain green as test infrastructure and as a source of
future agent tools. What follows describes what actually runs today.

### The engine

- `packages/core/src/agent/autonomous.ts` — the specialist framework for a
  reasoning agent. Interface `PentestTools` (implemented by the worker) gives
  the agent: `list_source_files`, `read_source_file`, `list_tables` (schema +
  RLS policies), `http_probe` (arbitrary authenticated requests as anon/A/B
  against PostgREST / edge / auth / raw), `oob_canary_*` (SSRF confirmation),
  `report_finding`, `conclude`. `createAutonomousPentester(brief, opts)` builds
  one `Specialist` scoped to an attack surface; `DEFAULT_PENTEST_SQUAD` = data /
  edge / surface agents.

- **Evidence gate — the load-bearing invariant, generalized.** The model can
  reason and probe freely, but `report_finding` requires a reproduction
  (probe+expected observable, or source citation). The executor RE-RUNS it and
  records the finding only if the observable actually holds:
  `status_2xx | status_ge_500 | returns_rows | row_owned_by_other |
  callback_fired | header_matches | source_contains`. Autonomy in reasoning,
  zero fabrication in results.

- `packages/core/src/agent/reviewer.ts` — post-hoc reviewer. One LLM call over
  the tail (last 10 steps × 1.5 KB) of each primary agent's transcript, hard
  cap of 3 leads, dedupe by surface+target+hypothesis prefix. For each lead,
  `runFollowup` spawns a scoped `createFollowupSpecialist` with an 8-step
  budget. Follow-up findings still go through the same evidence gate.

- `packages/core/src/agent/backend-brief.ts` — deterministic pre-recon.
  `buildBackendBrief` extracts RPC function bodies (SECURITY DEFINER flagged
  for missing `SET search_path` — a real vuln pattern), edge-fn signatures +
  `verify_jwt` state from `supabase/config.toml`, and injects the human text
  into every agent's initial prompt. Cuts wasted "grep the repo" steps.

- `packages/core/src/agent/repo-recon.ts` — Lovable-Cloud unlock. Detects
  Supabase URL + PUBLIC anon key + project ref from `.env` and generated
  `integrations/supabase/client.ts` (never scrapes service_role). Parses
  schema (types.ts) + RLS state (migrations, `CREATE POLICY … USING/WITH CHECK`,
  DROP/ALTER respected chronologically) into the same `TableIntel[]` shape the
  live catalog reader produces. Managed-Supabase projects with no DB access
  are fully scannable.

- `apps/worker/src/agent/pentest-toolbox.ts` — real `PentestTools` impl. Two
  guarantees: **SAFETY** (destructive edge fns classified in
  `discoverEdgeFunctions` are never invoked — `httpProbe` returns `{blocked}`);
  **HYGIENE** (all response bodies redacted before the model sees them — long
  free-text and known-sensitive keys become `<email>`/`<redacted>`; short
  scalar identifiers pass through so the agent can still reason about ownership).

- `apps/worker/src/agent/autonomous-campaign.ts` — logs in A+B (with admin-
  impersonation fallback via service_role when password login fails —
  35270cd), builds the shared toolbox, returns the entries + `makeDriver()`
  factory the reviewer + follow-up runners share (so cost accounting stays
  clean).

- `apps/worker/src/agent/pentest-source.ts` — `selectPentestSource` curates
  the repo to 80 backend-relevant files (config.toml, `_shared/*`, functions/*,
  migrations/*) so the agents don't waste their step budget on 300 files of
  UI + skills-markdown.

- `apps/worker/src/agent/anthropic-driver.ts` — prompt caching on system +
  tools + conversation prefix. Cost accounting reweights
  `cache_creation × 1.25` and `cache_read × 0.10` back into billable-equivalent
  input tokens so the shown cost matches the real bill (fc9a9ba fixed a bug
  where this counter was 5× inflated).

### Persona calibration (6fdb556 + 3cf1458)

The agent's system prompt now explicitly:
- Names how the redaction works (short scalar ids pass through — don't talk
  yourself out of a real leak thinking it was masked).
- Forbids "VULNERABILITY FOUND" narration before `report_finding` succeeds.
- Warns to interpret ambiguous HTTP statuses (204 from PATCH may be success
  OR a PostgREST protocol error — always inspect the body).
- Defines **vulnClass discipline** — pick by the NATURE of the bug, not the
  surface used to find it. Permissive RLS = `rls`, not `secret`.
- Defines **severity calibration** — critical: total takeover / unauth PII /
  service_role in browser. high: authed reads of others' private data.
  medium: spam / enumeration / permissive CORS without credentials. low:
  hardening.

### Persistence + UI

- Migration `0010` adds `scans.agent_report jsonb`. After each active-pentest,
  `campaignReportToPersisted` in scan-processor writes the full report
  (per-agent name, class, steps, cost, findings count, error, transcript up
  to 60 × 1.2 KB) there.
- `apps/web/components/dashboard/AgentReportPanel.tsx` — the "How the pen test
  ran" panel on Overview. Per-agent expander (icon = state, tokens, cost,
  transcript inline). Follow-up outcomes render with a violet "reviewer" pill.

### What it costs (measured on real Lovable projects)

- Primary squad (3 agents × 28 steps) on `usatopoint-test` (Lovable Cloud):
  ~$0.58, ~30 s, correct 0 findings.
- Same shape + reviewer + 2 follow-ups (one refuted, one confirmed): ~$0.58
  (follow-ups came out below 1¢ each thanks to prompt caching).
- Reviewer baseline (nothing to chase): +~$0.02.
- Cost cap enforced per org/month via `plans.ts` + `monthToDateCampaignCostCents`.

### Verified live

- **luneai**: 26 tables + 32 edge functions. RLS solid, edge functions
  correctly derive identity from JWT, 4 real CORS findings surfaced
  (`_shared/cors.ts` wildcard imported into most functions, and the correctly
  configured `_shared/security.ts` is NOT the one imported — the agent-surface
  went beyond a manual audit here).
- **usatopoint-test** (Lovable Cloud, no DB access): 28 tables detected from
  repo, 14 edge functions. Genuine finding filed via reviewer follow-up:
  `newsletter_public_insert` policy allows anon INSERT with only format
  validation → spam / enumeration primitive. Manually reclassified from
  `secret/high` (model's initial call) to `rls/medium` — this is what
  motivates issue #29 (triage layer).

### Known limitations (be honest with the user)

- LLM variance between runs. Two consecutive scans against the same project
  can file different subsets of the true finding set. That's why
  auto-resolve is DISABLED on the active-pentest path (3cf1458). The user
  closes findings explicitly via Mark resolved / False positive.
- Model can still mis-score severity or vulnClass despite calibration —
  hence #29 (triage) is the next slice.
- SSRF probe: the toolbox spins a localhost callback, which is unreachable
  from Supabase Cloud → SSRF is only confirmable against a target that runs
  outbound requests to arbitrary hosts. Public canary is future work.
- Non-Supabase backends: the whole engine assumes Postgres+PostgREST+
  Supabase Auth. Bolt/v0/Lovable/Cursor all sit on Supabase, so this is not
  an urgent gap — but Firebase/Convex projects are not scannable today.

## 11z. Legacy scripted specialists (still in-repo, not on the active path)

Foundation for the "XBOW-for-vibe-code" moat when first shipped:

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
    Copy + toggle live in `ActiveTestingConsentForm.tsx`. **Bumped to v3**
    with representations + limitation-of-liability + governing terms;
    multi-specialist now requires v3, existing v2 acceptances must
    re-accept. Settings shows a signed-record card + `.txt` download.
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

**Stage A shipped (#27 follow-up, first pass — Supabase-native).** The three
specialists whose backends can be expressed purely against Supabase now run
against the customer's real project — no repo-based endpoint discovery needed:

  · **BOLA** — logs in as accounts A + B via `POST /auth/v1/token`, discovers
    B-owned row ids via PostgREST (`/rest/v1/<table>?limit=2` as B), then as
    A replays those ids per table (`?id=eq.<val>`). Any hit = cross-account.
  · **RLS-deep** — as A, `GET /rest/v1/<table>?limit=3` and check whether any
    returned row's owner column (`user_id` / `owner_id` / …) is NOT A.
  · **Exposure** — as A, GET one row per table and hand ONLY field names to
    the executor, which cross-references against the sensitive-terms dict.

Table + owner-column discovery uses the existing `kelp_readonly` connection
(same read-only role the RLS static analyzer uses). Anon key comes from either
an explicit `supabase_anon_key` credential or is auto-fetched via the
Management PAT and cached back through `putCredential`. `app_base_url` is
now optional — no longer gates the campaign.

**Stage B shipped (Supabase Edge Functions).** The four HTTP-endpoint
specialists now probe the customer's Supabase Edge Functions, discovered
from the connected repo. For the vibe-coding stack this is the right
surface: the app is a static SPA that talks to Supabase directly, and the
hand-written backend logic lives in `supabase/functions/*/index.ts`
(deployed at `https://<ref>.supabase.co/functions/v1/<name>`) — that's where
the real auth-bypass / injection bugs are.

  · `packages/core/src/agent/edge-functions.ts` — `discoverEdgeFunctions`
    parses the repo's source files into `DiscoveredEdgeFunction[]`: name,
    body/query params, capability hints (identity/url params), and a
    **read-only vs mutating** classification. Conservative: mutating unless
    clearly safe (7 unit tests).
  · `apps/worker/src/agent/supabase-native/edge-backends.ts` — the four
    backends. **SAFETY: they only ever invoke NON-mutating functions** —
    delete-account / create-payment-checkout / add-user-role are discovered,
    reported, and never called. auth-bypass (does a function trust a client-
    supplied identity vs the JWT?) and injection (payload vs baseline) are the
    high-value classes for this stack; SSRF needs a public callback host (not
    yet) and weak-crypto is ~N/A (edge functions return JSON, not cookies).
  · scan-processor discovers edge functions via the GitHub connector (best-
    effort; a repo-read failure doesn't sink Stage A) and passes them to
    `buildCustomerCampaignEntries`, which appends the four specialists when
    ≥1 non-mutating function exists. `ScanningView` shows all 7 rows active.
  · `npm run verify:edge-backends -w @kelp/worker` — mock host with a
    deliberately-vulnerable `leaky-profile` (honors body userId) + `sqli-search`
    (500s on a quote) vs secure controls; asserts the backends flag the vulns
    and clear the controls. Verified live on luneai: 32 functions discovered,
    9 non-mutating probed, full 7-specialist campaign in ~26s / ~$0.06, zero
    false positives (luneai's functions correctly derive identity from the JWT).

**Remaining Stage B polish (open):** SSRF needs a publicly-reachable callback
canary to confirm out-of-band fetches from Supabase's cloud; a non-Supabase
(Next.js/Vercel/Express) discovery path for apps that aren't pure-SPA-on-Supabase.

## 11a. Findings lifecycle (post-#15, updated 3cf1458)

Two paths, deliberately different:

**Passive scans (deterministic — secret + RLS static).** Every scan closes what
it doesn't re-detect. After `upsertFindings` in scan-processor's
`executePassiveScan`, `resolveMissingFindings` closes findings whose
`last_scan_id <> currentScanId` and status is in (`open`, `pr_opened`,
`regressed`). Scoped to project × successfully-run vuln classes only.
`needs_review` / `confirmed` / `dismissed` are left alone. Existing resolve →
regress on re-detection (`upsertFindings`) is unchanged.

**Active-pentest scans (autonomous agents — non-deterministic).** Auto-resolve
is DISABLED. Between two consecutive runs, an autonomous agent may or may not
re-file the same true finding depending on which lead it chased first (LLM
variance) — treating "not seen this run" as evidence of fix would silently
close real vulns. The user closes findings explicitly:
 - `apps/web/app/dashboard/finding-actions.ts` → `markResolvedFinding` sets
   status = 'resolved'.
 - `reportFalsePositive` sets status = 'dismissed' AND writes a
   `finding_feedback` row (vuln_class, rule_id, title, location, fingerprint —
   never any secret value) to `packages/db/migrations/0009_finding_feedback.sql`.
Cards render two buttons: "Mark resolved" (positive) and "False positive"
(bordered, quieter). The feedback table is the seed of the detection-tuning
loop and the aggregate data moat.

## 11b. Webhook re-scan (post-#4)

`apps/web/app/api/github/webhook/route.ts` — GitHub push webhook. Verifies
`X-Hub-Signature-256` HMAC against `GITHUB_WEBHOOK_SECRET` (constant-time),
returns `ping` OK, ignores non-`push` events, non-default-branch pushes, and
pushes for repos not connected to a Kelp project. A matching push enqueues a
secret re-scan with `trigger='webhook_push'`. Requires the GitHub App's Webhook
URL set to `<APP_URL>/api/github/webhook` with the same secret and the `push`
event subscribed.

## 11d. Onboarding / connect flow (updated 9516589)

Onboarding is now a single step: pick a GitHub repo. No API-key prompt, no
Supabase project picker (`apps/web/app/onboarding/page.tsx` +
`connectAndScanAction`). After the repo is linked:
 1. A passive secret scan is enqueued immediately.
 2. `detectAndStoreSupabaseBackend` (worker/src/api.ts) reads the repo, detects
    URL + ref + public anon key, and persists them
    (`projects.supabase_project_ref` + credential kind `supabase_anon_key`).
 3. User is redirected to `/dashboard/configuration`, where the only required
    input is the two test accounts (+ consent for active pentesting).

The old "Configuration" fields (Supabase read-only role, Management PAT) are
still present under **Advanced (optional)**; they deepen the scan (live schema
vs repo-parsed) but are not needed on Lovable Cloud or any managed-Supabase
setup where the customer has no DB access.

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
