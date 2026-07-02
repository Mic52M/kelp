# Kelp

Self-serve security agent for **vibe-coded apps** — apps built with Lovable, Bolt.new,
Replit, Cursor or v0, typically on a Supabase backend. Kelp finds and helps fix the
security holes these tools routinely ship, for solo founders and small agencies who
have no security team.

**Positioning.** Not an enterprise scanner. Sign up alone, no sales call, value in
under 10 minutes. We never claim 100% coverage — we cover specific vulnerability
**classes** with high precision.

## What Kelp checks (MVP)

| Class | Detection | Fix in MVP |
|-------|-----------|------------|
| **RLS** missing/misconfigured on Supabase | Read schema via Supabase Management API; check RLS enabled per table + policies match standard access patterns | Generate `CREATE POLICY` SQL as a **proposed migration** (never auto-applied) |
| **Secrets** in code | Static scan of the connected GitHub repo (known key patterns + entropy) | Open a **PR** moving the value to an env var + rotation guidance |
| **BOLA** (broken object-level authz) | **Active test**: with two user-provided test accounts, try to read account B's resources using account A's session | **Report + human review only** (no auto-PR). See consent gate below |
| Auth weaknesses | *(stretch / V1.1)* | — |

## Architecture

Monorepo (npm workspaces). Deploy targets reflect the workload split:

```
apps/
  web/      Next.js (React + Tailwind) — UI + light API. Deploys to Vercel.
  worker/   Long-running scan jobs (RLS/secret/BOLA). Deploys to Railway/Fly.
            Pulls from a queue; serverless timeouts don't fit long scans.
packages/
  db/       SQL schema + migrations. The SQL is the source of truth.
  core/     Framework-agnostic domain logic: types + the consent guard.
```

- **Our database:** Postgres (Supabase-compatible), **multi-tenant from day one** —
  every tenant row carries `org_id` and is isolated by RLS (see
  `packages/db/migrations/0002_rls_policies.sql`). The web app connects as the
  `authenticated` role (RLS-scoped); the worker uses a privileged role that
  bypasses RLS by design and is never exposed to the browser.
- **Reasoning vs. determinism:** the Anthropic API (Claude) handles interpretation,
  fix generation and plain-language explanations. Everything that must not be
  probabilistic — reading schema, pattern-matching secrets, opening PRs — is
  deterministic code.
- **Integrations:** GitHub App (OAuth + PR creation, minimal scopes), Supabase
  Management API (read-only schema/policies), Stripe (billing), Anthropic.

## Legal constraints enforced in code (not just in the ToS)

These are product requirements implemented as technical controls:

1. **BOLA consent is a hard gate.** The active-test module runs only through
   `runWithActiveTestConsent()` in `packages/core/src/consent.ts`, which refuses
   unless a non-revoked `active_test_consents` row has `consented = true`. There is
   no other entry point to the BOLA scanner.
2. **No arbitrary third-party targets.** Active tests only ever run against a
   project connected through the authenticated OAuth flow — never a URL typed in.
3. **No end-user PII in clear text.** Exposed personal data of the customer's *end
   users* is stored/shown only as category + count (`finding_exposure_summary`),
   never raw values.
4. **Audit everything.** Every access to customer data writes to `audit_log`.
5. **Credentials encrypted at rest.** `project_credentials` / `bola_test_accounts`
   hold ciphertext only and are not selectable by the browser role. We avoid the
   Supabase `service_role` key when a lower-privilege key suffices.

## Pricing (to implement)

- **Free** — one full initial scan, report only (lead gen).
- **Starter (~€29/mo)** — continuous scanning + auto-fix (RLS, secrets), 1 project.
- **Agency (~€79–99/mo)** — up to 5 projects, same coverage.

## Status & next slices

Done: monorepo skeleton, multi-tenant schema + RLS, consent guard (typechecks).

Next, in order:
1. Auth + org/membership bootstrap (Supabase Auth), tenant-scoped DB clients.
2. GitHub App connect flow + Supabase Management API connect (encrypted creds).
3. Secret scanner (deterministic) + RLS scanner (schema read + Claude inference).
4. Scan orchestration on the worker + live progress UI.
5. Remediation: RLS migration + secret PR; BOLA "request review".
6. Stripe billing + plan gating. GitHub push webhook → re-scan.

## Local setup

```bash
cp .env.example .env.local      # fill in values
npm install
npm run typecheck
# Apply packages/db/migrations/*.sql in order via psql or the Supabase CLI.
```
