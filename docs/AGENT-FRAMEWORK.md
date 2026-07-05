# Kelp — Multi-Agent Pen-Testing Framework

> **Who this is for.** A new contributor (human or a fresh Claude session) who
> needs to understand, run, extend, or ship the multi-agent pen-testing engine.
> Read this after `docs/HANDOFF.md` — that gives you the *product* context; this
> one gives you the *engine*.
>
> **Status.** Phase 1 (framework) and Phase 2 (all seven planned specialists)
> are shipped and verified end-to-end. Phase 3 (consent v2, cost accounting,
> live-driver verify variants) is open — see the "What's next" section at the
> bottom.

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

The consent version is currently `"v1"` (BOLA-only wording). Phase 3 issue
#24 bumps this to `"v2"` with the multi-specialist copy.

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

### 7.4 Run the unit tests

```bash
npm test   # from the repo root
```

Expected: `ℹ tests 99` / `pass 99` / `fail 0`.

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

6. **Write the verify script + npm script.**
   - `apps/worker/src/agent/verify-<name>-target.ts` — copy the closest
     existing one.
   - Add `"verify:<name>-target": "node dist/agent/verify-<name>-target.js"`
     to `apps/worker/package.json`.

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

apps/worker/src/agent/
  anthropic-driver.ts             Real LlmAgentDriver against Anthropic API
  test-target-<name>-backend.ts   Real HTTP probe backend, one per specialist
  verify-<name>-target.ts         E2E validation script, one per specialist

apps/test-target/
  src/server.ts                   Express app with 7 vulnerable + 7 control pairs
  README.md                       Ground-truth table + curl sanity checks

packages/db/migrations/
  0001_init.sql                   Original schema (vuln_class starts here)
  0004_vuln_class_injection.sql   ALTER TYPE for 'injection'
  0005_vuln_class_ssrf.sql        ALTER TYPE for 'ssrf'
  0006_vuln_class_exposure.sql    ALTER TYPE for 'exposure'

docs/
  HANDOFF.md                      Product context (start here)
  AGENT-FRAMEWORK.md              This file (engine architecture)
```

---

## 11. What's next (phase 3)

The moat is functionally alive. What separates it from being production-ready:

- **#24 — Consent v2 (copy + migration + onboarding UI).** The consent
  version is still `"v1"` (BOLA-only wording). Multi-specialist campaigns
  need a copy that enumerates every enabled specialist, the concurrency
  ceiling, and the data-hygiene guarantees, and a `"v2"` accept in the
  Settings UI. Bumping the DB constant is the small part; getting the copy
  right is the load-bearing part.
- **#25 — Per-specialist Claude token cost accounting.** Every specialist
  runs its own Claude conversation. With seven specialists in parallel per
  campaign, cost visibility becomes a prerequisite for pricing and for
  per-org rate limits. Plan: track `usage` on the Anthropic driver, plumb
  it through `SpecialistOutcome`, add a `scans.cost_cents` column, refuse
  campaigns projected over the plan cap.
- **#26 — Live Anthropic-driver verify variants.** Every current verify
  script uses a scripted driver — that's fine to validate the executor and
  the backend, but doesn't validate the prompt. Before enabling multi-agent
  in the customer path, each specialist needs a `verify-<name>-target-live.ts`
  that uses the real Anthropic driver end-to-end. Gate on #25 so we have
  cost ceilings.

Beyond phase 3, everything for a live customer path lives in the
independent lanes: deployment (#16), Stripe billing + gating (#10 + #17),
Supabase per-project read-only role (#5), Redis-backed queue (#7). None of
those block the multi-agent framework — they block the *product* around it.

---

## 12. Verified end-to-end today

At the time this file is written, on `master`:

- **99/99** core unit tests green.
- **7/7** `npm run verify:*-target -w @kelp/worker` scripts exit 0 against
  the running test target.
- **Zero false positives** on any control endpoint across all seven
  specialists.

If any of the above regresses on your machine before you've touched the
framework, that's the first thing to investigate — not a specialist change.
