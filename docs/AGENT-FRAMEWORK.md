# Kelp — Multi-Agent Pen-Testing Framework

> **Who this is for.** A new contributor (human or a fresh Claude session) who
> needs to understand, run, extend, or ship the pen-testing engine. Read this
> after `docs/HANDOFF.md` — that gives you the *product* context; this one
> gives you the *engine*.

## ⚠️ Big change (2026-07-08) — read this first

The rest of this document describes the **scripted seven-specialist framework**
(BOLA / auth-bypass / injection / SSRF / exposure / RLS-deep / weak-crypto).
That framework still exists in the repo (as of 2026-07-09) — see
`packages/core/src/agent/specialists/*.ts` and the factories under
`apps/worker/src/agent/{customer-backends,supabase-native/*-backend,edge-backends,test-target-*-backend}.ts`.

**But it is no longer on the active-pentest scan path.** It was replaced by a
smaller, more powerful **autonomous multi-agent engine** where three agents
(data / edge / surface) reason freely over a shared toolbox instead of walking
fixed `list_endpoints → probe → report` scripts. A post-hoc **reviewer** spawns
focused follow-up agents to chase leads the primary squad didn't confirm.

Read `docs/HANDOFF.md § 11 "Autonomous pen-test engine (current)"` for the
authoritative description of what runs today, then use this document for:

- The **load-bearing invariant** ("no confirmed evidence → no finding") — still
  the design's most important idea, generalized rather than replaced. The
  autonomous executor enforces it via `handleReport` + `confirm` in
  `packages/core/src/agent/autonomous.ts`.
- The **orchestrator + `runActivePentest`** — still used by the autonomous
  engine to dispatch its 3 agents, and by the reviewer to spawn follow-ups
  (`runOne` / `runCampaign` / crash isolation / usage aggregation — unchanged).
- The **specialist framework** (`packages/core/src/agent/specialist.ts`) — still
  the abstraction the autonomous agents plug into.
- The **test target** (`apps/test-target`) — still ships the ground-truth
  vulnerabilities the legacy `verify:*-target` scripts assert against. Green.

Scripted specialists that **remain green as test infrastructure** (do NOT
delete):
`verify:bola-target`, `verify:auth-bypass-target`, `verify:injection-target`,
`verify:ssrf-target`, `verify:exposure-target`, `verify:rls-deep-target`,
`verify:weak-crypto-target`, `verify:edge-backends`.

New pieces the autonomous engine added on top (see HANDOFF § 11 for detail):
- `agent/autonomous.ts` — reasoning agent + `PentestTools` + evidence gate.
- `agent/reviewer.ts` — post-hoc reviewer + `runFollowup`.
- `agent/backend-brief.ts` — deterministic pre-recon pack.
- `agent/repo-recon.ts` — detect Supabase config + schema from repo (Lovable
  Cloud unlock).
- `agent/edge-functions.ts` — edge-fn discovery + destructive-fn safety.
- `apps/worker/src/agent/pentest-toolbox.ts` — real `PentestTools` impl.
- `apps/worker/src/agent/pentest-source.ts` — repo source curation.
- Persona calibration in `autonomous.ts` (vulnClass + severity discipline).
- Migration `0010` — `scans.agent_report` persisted per-agent transcripts.

---

## Historical: the scripted specialist framework

*The following describes the framework as it stood at the end of Phase 3,
before the autonomous-engine pivot. It's still accurate about the shared
infrastructure (orchestrator, evidence-gate philosophy, test target), and the
seven specialists are still in-tree — but they're no longer what runs during
a customer scan.*

---

## 1. What this is, in one paragraph

Kelp's pen-testing engine is a **consent-gated, multi-specialist LLM
orchestrator**. Given a project, it runs a *campaign*: several Claude-driven
specialist agents run in parallel, each hunting one vulnerability class. Every
specialist has a deterministic **Executor** that owns the truth of what was
found — the LLM can never write a finding into the database, only *request* it.
Executors refuse those requests unless a preceding **probe** returned confirmed
evidence. This is what lets Kelp truthfully say "we never claim 100% coverage,
but every finding we report is real."

Seven specialists cover seven distinct detection patterns today:
BOLA, auth-bypass, injection, SSRF, data-exposure, RLS-deep, weak-crypto.
Each was validated end-to-end against a deliberately-vulnerable in-repo test
target (`apps/test-target`) that ships a matching **vulnerable + control**
endpoint per class, so we can prove both "the flaw is caught" and "the fix
is *not* falsely flagged."

---

## 2. Why this exists

Kelp already ships **deterministic** scanners (regex-based secret detection,
static RLS policy analysis, deterministic BOLA reporting). They're fast,
precise, and reproducible — but they only catch what a regex or a schema query
can see. The differentiated product — the moat — is a **live, agentic**
pen tester that finds the classes those scanners can't:

- BOLA where the endpoint *has* an authorization check but it's the wrong one.
- SQL injection whose payload only surfaces when you compare response counts.
- SSRF you can only confirm by watching an outbound network hit.
- RLS bugs where the policy exists but resolves to `true` for the wrong role.

Three product principles the framework was built to enforce:

1. **The model plans and explores; Kelp decides.** The LLM picks *what* to
   probe; the Executor decides *whether the probe confirmed a finding*.
2. **No unconfirmed findings, ever.** A finding without matching probe
   evidence is refused at the tool boundary. The invariant is enforced in
   code, not by prompt.
3. **No third-party data crosses the tool boundary.** Backends return row
   counts, field names, callback hits — never bodies, values, or PII.

---

## 3. Architecture (four layers)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Layer 4 — Consent gate                                              │
│  packages/core/src/consent.ts  →  runWithActiveTestConsent(…)        │
│  Refuses to run a campaign unless the project has a valid,           │
│  non-revoked active-test consent.                                    │
└────────────────────────────────┬─────────────────────────────────────┘
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Layer 3 — Orchestrator (multi-specialist campaign)                  │
│  packages/core/src/agent/orchestrator.ts                             │
│    runActivePentest(deps, ctx, config)   ← consent-gated entry       │
│    runCampaignUnsafe(ctx, config)        ← unit-test escape hatch    │
│  Worker pool (maxParallel), per-specialist error isolation,          │
│  outcomes returned in caller-provided order, aggregated findings.    │
└────────────────────────────────┬─────────────────────────────────────┘
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Layer 2 — Specialist                                                │
│  packages/core/src/agent/specialist.ts                               │
│    interface Specialist<Backend, Finding>                            │
│      { name, vulnClass, systemPrompt, tools, initialPrompt(),        │
│        createExecutor(backend, ctx) → SpecialistExecutor<Finding> }  │
│  Executor owns the load-bearing invariant                            │
│    "no confirmed probe → no finding"                                 │
│  Executor is a plain ToolExecutor from Layer 1 — reuses runAgent.    │
└────────────────────────────────┬─────────────────────────────────────┘
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Layer 1 — LLM tool-use loop                                         │
│  packages/core/src/agent/loop.ts                                     │
│    runAgent(driver, executor, { system, tools, prompt, maxSteps })   │
│  Model-agnostic: the concrete Anthropic driver lives in the worker;  │
│  tests inject a scripted driver.                                     │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.1 Layer 1 — the tool-use loop

`runAgent` is a **model-agnostic** driver of a single tool-use conversation:

- The `LlmAgentDriver` interface owns message state and knows how to call
  Claude (or how to replay a scripted script during tests).
- The `ToolExecutor` interface runs tool calls deterministically and returns
  their results.

The loop is dumb on purpose: it starts, it dispatches every tool call the
driver returns, and it stops when the driver says done or when `maxSteps`
runs out. All specialization is one layer up.

### 3.2 Layer 2 — Specialist

A `Specialist<Backend, Finding>` is the **only** thing you write when adding a
new vulnerability class. It declares:

- `name` (stable identifier for audit + telemetry)
- `vulnClass` (feeds the DB `vuln_class` enum — see migrations 0001, 0004,
  0005, 0006)
- `systemPrompt` (what Claude reads at the top)
- `tools` (the JSON-Schema tool contracts)
- `initialPrompt(ctx)` (the first user message; typically references the
  project id)
- `createExecutor(backend, ctx)` (the deterministic thing that turns tool
  calls into probes and confirmed findings)

The **executor** is where the load-bearing invariant lives. Every specialist's
executor maintains a `confirmed` set keyed by the probe input, and every
`report_finding` tool call is rejected unless the matching key is in that set.

**Token & cost usage (issue #25).** An `LlmAgentDriver` may optionally implement
`getUsage(): LlmUsage` — cumulative `{ inputTokens, outputTokens, model? }` since
`start()`. The Anthropic driver populates it; scripted test drivers omit it (a
missing `getUsage` is not an error — the orchestrator treats it as "cost
accounting not available"). See §3.5 for how those numbers flow to the outcome.

### 3.3 Layer 3 — Orchestrator

`runActivePentest` is the campaign entry point. Given a list of
`SpecialistEntry<unknown, unknown>[]` (each specialist plus its backend and its
driver), it:

1. Passes the whole campaign through the consent gate.
2. Dispatches specialists into a bounded worker pool (`maxParallel`, default =
   all).
3. Wraps each specialist run in a `try/catch` so one crashing specialist
   doesn't kill the campaign — its outcome carries an `error` string instead.
4. Returns outcomes in the caller-provided specialist order (not completion
   order — the report is stable and reproducible even under concurrency).
5. Aggregates `findings` across all successful specialists.

The `runCampaignUnsafe` variant skips the consent gate. **Never use it from a
customer-facing path** — it exists only for unit tests where we don't want to
mock the consent store.

### 3.4 Layer 4 — Consent gate

`runWithActiveTestConsent` is the **single legal chokepoint** for any active
Kelp test. It:

- Reads the current consent row from the injected `ConsentStore`.
- Throws `ConsentRequiredError` if none, revoked, or `consented !== true`.
- Writes an audit row (org_id, project_id, actor, action, consent metadata)
  BEFORE running the task.
- Only then runs the campaign.

Consent version — since #24, `packages/core/src/consent.ts` exports two
constants (bumped to v3 in the setup-UX pass):

- `CONSENT_ACCEPTED_FOR_BOLA_ONLY = ["v1", "v2", "v3"]` — legacy BOLA-only
  path; old v1/v2 acceptances still valid for the single-class run.
- `CONSENT_ACCEPTED_FOR_MULTI_SPECIALIST = ["v3"]` — multi-specialist
  campaigns MUST pass this via `acceptedVersions` on the campaign context,
  so a v1/v2-only project can never trigger a multi-specialist run.
  v3 adds a Representations block, limitation-of-liability, and governing-
  terms language; any project on v2 must re-accept the new copy in
  Settings before the "Run active pen test" button unlocks.

`runWithActiveTestConsent` takes an optional `{ acceptedVersions }` option: if
present, the stored consent version must be in that list, otherwise
`ConsentRequiredError` is thrown. `runActivePentest` forwards
`ctx.acceptedVersions` — always set it to `CONSENT_ACCEPTED_FOR_MULTI_SPECIALIST`
from any multi-specialist call site.

### 3.5 Cost accounting (issue #25)

Every specialist runs its own Claude conversation, so a campaign's cost is
non-trivial and needs to be visible + bounded before the model burns tokens.

- **Pricing.** `packages/core/src/agent/pricing.ts` holds a prefix-keyed rate
  table (Opus 4.7/4.8, Sonnet 5, Haiku 4.5 — USD per million tokens).
  `estimateCostUsd(usage)` matches the longest key that the driver's `model` id
  starts with, so versioned suffixes (e.g. `claude-haiku-4-5-20251001`) resolve
  to the base rate without an entry per date. Unknown model → returns `0`
  (fine for tests; production callers must cap explicitly).
- **Attribution.** After each specialist finishes, `runActivePentest` calls
  `collectUsage(driver)` and attaches a `SpecialistUsage` — `{ inputTokens,
  outputTokens, estimatedCostUsd }` — to that outcome. Drivers with no
  `getUsage` yield `usage: null` (scripted tests).
- **Aggregation.** The campaign result carries `totalUsage: SpecialistUsage`
  summed across every outcome that reported it. Callers persist this into
  `scans.cost_cents` via `costUsdToCents` (migration `0007_scan_cost.sql`).
- **Caps.** `MONTHLY_CAMPAIGN_CAP_CENTS: Record<PlanTier, number>` and
  `assertUnderCap` throw a typed error the API layer maps to HTTP 402. Free
  tier has a cap of `0` — active pen-testing is paid-only.
- **Verify.** `npm run verify:cost-accounting -w @kelp/worker` exercises the
  driver → outcome plumbing end-to-end against the test target with the
  scripted driver (asserts usage nulls where expected + populated where the
  driver reports it).

---

## 4. The load-bearing invariant

Every specialist's executor enforces this contract:

> **A `report_finding` tool call is rejected unless a matching prior
> `probe_*` tool call, on the same key, returned confirmed evidence.**

The "key" is class-specific — see the table below. The invariant is not a
prompt-level suggestion; it lives in the executor's `if (!this.confirmed.has(key)) return { isError: true, … };` line. The LLM can lie in its `assistantText`
and it doesn't matter — the executor holds the truth.

| Specialist  | Confirmation key                                | Evidence returned by the probe                                          |
| ----------- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| BOLA        | `(endpoint, parameter)`                         | `crossAccountAccess === true` (A read B's row)                          |
| Auth-bypass | `(endpoint, technique)`                         | `bypassed === true` (impersonation honored)                             |
| Injection   | `(endpoint, parameter)`                         | `bypassed === true` (payload widened result set vs baseline)            |
| SSRF        | `(endpoint, parameter, technique)`              | `bypassed === true` (out-of-band listener recorded the callback)        |
| Exposure    | `endpoint` (plus Kelp's sensitive dictionary)   | Response field names include a sensitive term                            |
| RLS-deep    | `table`                                         | `crossAccountAccess === true` (A read B's rows)                         |
| Weak-crypto | `endpoint`                                      | Set-Cookie header missing at least one of HttpOnly / Secure / SameSite  |

Two invariants deserve extra emphasis:

- **Exposure**: Kelp — not the model — decides which field names count as
  sensitive. The dictionary lives in `packages/core/src/agent/specialists/exposure.ts`.
- **Weak-crypto**: Kelp — not the model — decides which flags are required
  on a session cookie. Kept short (HttpOnly, Secure, SameSite) to keep the
  false-positive rate near zero.

---

## 5. The seven specialists

Each specialist is `~150-250 LOC` and follows the same shape: `tools`,
`system` prompt, `initialPrompt`, executor class implementing the invariant.

| # | Specialist    | `vulnClass` | Detection shape                                       | Class-specific finding fields                  |
| - | ------------- | ----------- | ----------------------------------------------------- | ---------------------------------------------- |
| 1 | `bola`        | `bola`      | Cross-account probe by resource id                    | `endpoint`, `resourceKind`, `parameter`        |
| 2 | `auth-bypass` | `auth`      | Impersonation techniques (query, header, token swap)  | `endpoint`, `technique`                        |
| 3 | `injection`   | `injection` | Baseline vs payload result-set diff                   | `endpoint`, `parameter`, `payloadFamily`       |
| 4 | `ssrf`        | `ssrf`      | Out-of-band callback listener                         | `endpoint`, `parameter`, `technique`           |
| 5 | `exposure`    | `exposure`  | Response field-name audit vs sensitive dictionary     | `endpoint`, `sensitiveFields`                  |
| 6 | `rls-deep`    | `rls`       | Cross-account probe at the *table* level              | `table`                                        |
| 7 | `weak-crypto` | `auth`      | Set-Cookie flag audit                                 | `endpoint`, `cookieName`, `missingFlags`       |

Files: `packages/core/src/agent/specialists/*.ts`. Each has a sibling
`*.test.ts` (99 tests total, all green).

Two class notes:

- **`rls-deep` reuses `vulnClass: "rls"`** on purpose — the fix path is the
  same as the static analyzer's findings. Static and active RLS detections
  merge into one class in the DB.
- **`weak-crypto` reuses `vulnClass: "auth"`** — same reason. Cookie hygiene
  and session-identity bypasses share fix ownership.

---

## 6. The test target

`apps/test-target` is a small Express app you run on `localhost:4400` that
ships **known-vulnerable + control** endpoints, one pair per specialist. It
lets us assert both sides of the invariant end-to-end:

- The vulnerable endpoint IS flagged (so specialists don't silently miss).
- The control is NOT flagged (so specialists don't drift into false positives).

⚠️ **Do not deploy this app anywhere that isn't localhost.** It has hard-coded
credentials, a weak session-signing key, deliberately-leaky endpoints, and a
mock-DB whose `orders_public` table intentionally has no ownership check.

| Class        | Vulnerable                                | Control                                    |
| ------------ | ----------------------------------------- | ------------------------------------------ |
| BOLA         | `GET /api/orders/:id`                     | `GET /api/profiles/:id`                    |
| Auth-bypass  | `GET /api/session-lookup?as=…`            | `GET /api/me`                              |
| Injection    | `GET /api/orders/search?q=…`              | `GET /api/orders/find?q=…`                 |
| SSRF         | `GET /api/fetch?url=…`                    | `GET /api/fetch-safe?url=…`                |
| Exposure     | `GET /api/admin/users-with-hashes`        | `GET /api/public-users`                    |
| RLS-deep     | `GET /api/db/select?table=orders_public&owner=…` | `orders_scoped` table (same endpoint)|
| Weak-crypto  | `GET /api/set-insecure-cookie`            | `GET /api/set-secure-cookie`               |

Seed users are `a@test.local` / `secretA` (userA) and `b@test.local` /
`secretB` (userB). `apps/test-target/README.md` has the full ground-truth
table with each expected outcome.

---

## 7. How to run everything locally

Requires: repo cloned, `npm install` done, `.env.local` present (see
`.env.example`). No external secrets are needed for the multi-agent
verifications — each specialist runs against the local test target with a
scripted driver.

### 7.1 Build everything

```bash
npm run build --workspace @kelp/core
npm run build --workspace @kelp/worker
npm run build --workspace @kelp/test-target
```

### 7.2 Boot the test target

```bash
# Foreground (Ctrl+C to stop):
npm run dev --workspace @kelp/test-target

# Or background:
node apps/test-target/dist/server.js &
```

You should see it print the full list of endpoints on stdout.
Sanity check: `curl -s http://localhost:4400/health` → `{"ok":true,…}`.

### 7.3 Run all seven verify scripts

Each verify script boots one specialist campaign against the running target,
exits `0` on success (vulnerable IS flagged, control is NOT), non-zero
otherwise.

```bash
# One at a time:
npm run verify:bola-target        --workspace @kelp/worker
npm run verify:auth-bypass-target --workspace @kelp/worker
npm run verify:injection-target   --workspace @kelp/worker
npm run verify:ssrf-target        --workspace @kelp/worker
npm run verify:exposure-target    --workspace @kelp/worker
npm run verify:rls-deep-target    --workspace @kelp/worker
npm run verify:weak-crypto-target --workspace @kelp/worker

# Or all seven in one shot (test target must be running):
for name in bola auth-bypass injection ssrf exposure rls-deep weak-crypto; do
  echo "═══ $name ═══"
  node apps/worker/dist/agent/verify-$name-target.js
done
```

Expected: each script prints a green ✓ for both the vulnerable and the control
endpoint and exits 0.

### 7.3.1 Live-Anthropic verify (issue #26)

Every specialist has a sibling `verify-<name>-target-live.ts` that swaps the
scripted driver for the real Anthropic driver — same target, same assertions,
but the LLM actually plans the probes. Gated by `KELP_ANTHROPIC_LIVE=1` so a
casual `verify:*` sweep can't burn tokens by accident; without the env var each
live script prints why it skipped and exits 0.

```bash
# All seven, chained (test target must be running, valid ANTHROPIC_API_KEY):
KELP_ANTHROPIC_LIVE=1 npm run verify:live --workspace @kelp/worker

# One at a time follow the same naming — e.g.:
KELP_ANTHROPIC_LIVE=1 npm run verify:bola-target-live --workspace @kelp/worker
```

Each live script prints tokens in/out and cost USD before exiting. Shared
wiring is in `apps/worker/src/agent/live-verify.ts` (env gate, driver
creation, cost printing) so each variant only declares WHAT to test.

### 7.3.2 Cost-accounting verify (issue #25)

```bash
npm run verify:cost-accounting --workspace @kelp/worker
```

Runs a campaign through `runActivePentest` with mixed scripted + usage-emitting
drivers and asserts `SpecialistUsage` attaches per outcome, `totalUsage`
aggregates correctly, and `null` propagates when a driver has no `getUsage`.

### 7.4 Run the unit tests

```bash
npm test   # from the repo root
```

Expected: `ℹ tests 121` / `pass 121` / `fail 0`.

### 7.5 Reading a verify script

Each `apps/worker/src/agent/verify-<name>-target.ts` follows a repeating
shape you can pattern-match:

1. **Config** — the base URL and account credentials.
2. **`ScriptedDriver`** — the LLM stand-in: replies to `list_endpoints` /
   `probe_*` / `report_finding` in a deterministic order.
3. **Backend** — the real HTTP glue that talks to `:4400` and returns
   evidence.
4. **Assertions** — vulnerable IS flagged, control is NOT. Exit 0/1.

---

## 8. How to add an 8th specialist

The pattern is well-worn after seven. Rough recipe (~1h once you have a
target endpoint in mind):

1. **Extend the DB enum if the class is new.**
   - Add the value to `VulnClass` in `packages/core/src/types.ts`.
   - Add migration `packages/db/migrations/000N_vuln_class_<name>.sql` with
     `alter type vuln_class add value if not exists '<name>';`. Migration
     files for enum extensions must NOT be wrapped in a transaction.
   - Apply it against the current DB (see `packages/db/src/migrate.ts` or
     the one-liner used in the RLS-deep / SSRF commits).

2. **Write the specialist.**
   - `packages/core/src/agent/specialists/<name>.ts`.
   - Copy the closest existing specialist (`injection.ts` and `ssrf.ts` are
     the best templates) and change:
     - the tool names (`list_endpoints`, `probe_<name>`, `report_finding`),
     - the executor's `confirmed` key (see the table in §4),
     - the finding fields.
   - Preserve the invariant: `report_finding` must return `{ isError: true }`
     if the confirmation key isn't in the map.

3. **Write the unit tests.**
   - `packages/core/src/agent/specialists/<name>.test.ts`.
   - Four minimum tests: flags the vulnerable case, no false positive on the
     control, `report_finding` refused without a matching probe, `report_finding`
     refused when the confirmed probe used a different key.

4. **Extend the test target.**
   - Add one vulnerable endpoint and one properly-scoped control to
     `apps/test-target/src/server.ts`.
   - Update the target's `README.md` ground-truth table.

5. **Write the HTTP backend.**
   - `apps/worker/src/agent/test-target-<name>-backend.ts`.
   - Real `fetch` against the running target. Return only the evidence
     needed to prove the invariant — never bodies, values or PII.

6. **Write the (scripted) verify script + npm script.**
   - `apps/worker/src/agent/verify-<name>-target.ts` — copy the closest
     existing one.
   - Add `"verify:<name>-target": "node dist/agent/verify-<name>-target.js"`
     to `apps/worker/package.json`.

6b. **Write the live-driver verify variant (issue #26).**
   - `apps/worker/src/agent/verify-<name>-target-live.ts` — copy the closest
     existing one (they're ~30 LOC each; the harness in `live-verify.ts` does
     the wiring). Declare the specialist, `makeBackend`, and 1-2 assertions
     against the confirmed findings.
   - Add `"verify:<name>-target-live"` + append it to the `verify:live` chain
     in `apps/worker/package.json`. The env gate (`KELP_ANTHROPIC_LIVE=1`) is
     enforced by the harness — you don't wire it yourself.

7. **Update the specialist index.**
   - Add `export * from "./agent/specialists/<name>.js";` to
     `packages/core/src/index.ts`.

8. **Update docs.**
   - This file (`docs/AGENT-FRAMEWORK.md`) — add the new specialist to the
     table in §5, extend §7 with its verify command.
   - `docs/HANDOFF.md` — one-liner in the specialists section.

9. **Verify.**
   - `npm run build --workspace @kelp/core && npm run build --workspace @kelp/worker && npm test`
   - Boot the target, run the new verify script, expect exit 0.

10. **Commit.** Follow the message format used in commits `075aa6f`,
    `c9c106f`, `f859803` — those are the reference for a good specialist commit.

---

## 9. Data hygiene guarantees

These are contractual, not aspirational. Every backend must uphold them; the
review criterion for a new specialist is "would this pass an audit against
the following list?"

- **No third-party bodies** are inspected by the tool boundary. What crosses
  it is: row counts, response status codes, field NAMES, callback listener
  hits, Set-Cookie flag NAMES. That's it.
- **No customer PII** is persisted. When a finding references end-user data,
  it uses the `finding_exposure_summary` table (category + count, never
  values) that already exists in the schema.
- **Every probe is audited.** The specialist backends do their own audit
  writes for individual probes; the campaign entry (consent gate) writes the
  top-level `active_pentest_campaign` audit row.
- **Consent is a hard gate.** Any code path that reaches Layer 3 without
  going through Layer 4 is a bug. `runCampaignUnsafe` is exported only for
  unit tests and must never be imported from `apps/web` or from a worker
  handler on a customer scan.

---

## 10. Where each piece lives (file map)

```
packages/core/src/
  types.ts                        vuln_class enum, VulnClass string union
  consent.ts                      Layer 4 (consent gate)
  agent/
    loop.ts                       Layer 1 (LLM tool-use loop)
    specialist.ts                 Layer 2 interface
    orchestrator.ts               Layer 3 (multi-specialist campaign)
    bola.ts                       Legacy runBolaAgent (delegates to orchestrator)
    specialists/
      bola.ts / .test.ts          Specialist 1
      auth-bypass.ts / .test.ts   Specialist 2
      injection.ts / .test.ts     Specialist 3
      ssrf.ts / .test.ts          Specialist 4
      exposure.ts / .test.ts      Specialist 5
      rls-deep.ts / .test.ts      Specialist 6
      weak-crypto.ts / .test.ts   Specialist 7

packages/core/src/
  plans.ts                        Plan tiers + limits (#17) — feeds cost caps
  agent/
    pricing.ts / pricing.test.ts  Model rate table + estimateCostUsd (#25)

apps/worker/src/
  redis-queue.ts                  BullMQ scan queue (#7)
  stripe.ts                       Checkout + webhook wiring (#10)
  connectors/supabase-pg.ts       Per-project read-only Postgres role (#5)
  agent/
    anthropic-driver.ts           Real LlmAgentDriver against Anthropic API
    test-target-<name>-backend.ts Real HTTP probe backend, one per specialist
    verify-<name>-target.ts       Scripted-driver E2E, one per specialist
    verify-<name>-target-live.ts  Live-Anthropic E2E, one per specialist (#26)
    verify-cost-accounting.ts     Usage plumbing E2E (#25)
    live-verify.ts                Shared harness for the *-live scripts (#26)

apps/web/components/dashboard/
  ActiveTestingConsentForm.tsx    Consent v2 UI (#24)
  UpgradeButton.tsx               Stripe checkout entry (#10)
  SupabaseReadonlyForm.tsx        Per-project read-only role setup (#5)

apps/test-target/
  src/server.ts                   Express app with 7 vulnerable + 7 control pairs
  README.md                       Ground-truth table + curl sanity checks

packages/db/migrations/
  0001_init.sql                   Original schema (vuln_class starts here)
  0004_vuln_class_injection.sql   ALTER TYPE for 'injection'
  0005_vuln_class_ssrf.sql        ALTER TYPE for 'ssrf'
  0006_vuln_class_exposure.sql    ALTER TYPE for 'exposure'
  0007_scan_cost.sql              scans.cost_cents column (#25)

docs/
  HANDOFF.md                      Product context (start here)
  AGENT-FRAMEWORK.md              This file (engine architecture)
```

---

## 11. What's next — endpoint discovery (#27 follow-up)

**#27 MVP shipped.** The engine is now reachable from the customer dashboard:

- **Migration `0008`** adds `projects.app_base_url` and
  `scans.mode ∈ {'passive', 'active_pentest'}`.
- **`executeActivePentestScan`** in `apps/worker/src/scan-processor.ts`
  branches on `scans.mode`, gates on plan tier (#17) + consent v2 (#24) +
  monthly cost cap (#25), dispatches the seven-specialist campaign via
  `buildCustomerCampaignEntries`, persists findings via the new
  `campaignFindingsToDetected` mapper and cost via `scans.cost_cents`.
- **Dashboard**: `ActivePentestButton` top-bar CTA (paid only, gated on
  consent + `app_base_url`), Settings section with `ActivePentestConfigForm`
  for `app_base_url` + two encrypted test-account credentials,
  `ScanningView` renders a per-specialist checklist when
  `mode === 'active_pentest'`.
- **`verify:campaign-e2e`** boots the test target, seeds a scratch
  org+project + consent v2, runs one campaign through the full
  scan-processor path, asserts findings written and `cost_cents`
  populated. Gated by `KELP_ANTHROPIC_LIVE=1`.

**What's still open (#27 follow-up).** The MVP customer backends live in
`apps/worker/src/agent/customer-backends/index.ts` and re-use the seven
test-target backend factories — same probe shapes, but parameterized by
the customer's `app_base_url` + encrypted test accounts. That means a
customer whose deployed app happens to expose endpoints matching the
test-target shape (`POST /api/login`, `GET /api/orders/:id`,
`GET /api/session-lookup?as=…`, …) gets real findings today; a customer
whose endpoints look different gets zero (the specialist logs in and its
tools return "no such endpoint" — its outcome carries `error`, but the
campaign continues).

Closing that gap = **real endpoint discovery**:

- Parse routes from the connected repo (`listSourceFiles` already exists)
  for Express / Next.js / Hono / Fastify style handlers. Extract path +
  method + the auth-relevant param name.
- Map Supabase tables (via the read-only role, #5) to the RLS-deep
  specialist's `list_tables` tool.
- Feed both into the customer backends so `list_endpoints` /
  `list_tables` return the customer's actual surface, not the
  test-target seed.

Everything else (deployment #16, GitHub App rotation #1, App public + org
#2, design pass #13) is independent of the multi-agent roadmap.

---

## 12. Verified end-to-end today

At the time this file is written, on `master` (commit `2728570` or later):

- **121/121** core unit tests green (includes pricing + consent v2 coverage).
- **7/7** `npm run verify:*-target -w @kelp/worker` scripts exit 0 against
  the running test target (scripted driver).
- **7/7** `npm run verify:*-target-live -w @kelp/worker` scripts exit 0 when
  run with `KELP_ANTHROPIC_LIVE=1` + a valid `ANTHROPIC_API_KEY` (real
  Anthropic driver).
- **`verify:cost-accounting`** exits 0.
- **Zero false positives** on any control endpoint across all seven
  specialists.

If any of the above regresses on your machine before you've touched the
framework, that's the first thing to investigate — not a specialist change.
