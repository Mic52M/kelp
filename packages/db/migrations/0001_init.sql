-- Kelp application schema (our data, not the customer's).
-- Multi-tenant from day one: every customer-owned row carries org_id.
-- Portable Postgres (works on Supabase or plain Postgres).
--
-- Design invariants encoded here (see README "Legal constraints in code"):
--   1. Tenant isolation: org_id on every tenant table + RLS (migration 0002).
--   2. Active-test (BOLA) consent is a hard gate: the BOLA module MUST NOT run
--      unless a matching row in active_test_consents has consented = true and
--      revoked_at IS NULL. Enforced in code (packages/core/consent.ts) AND
--      recorded here as the source of truth.
--   3. Audit: every access to customer data is written to audit_log.
--   4. Exposed personal data of the customer's END USERS is never stored in
--      clear text — only category + count, in finding_exposure_summary.

begin;

create extension if not exists "pgcrypto";  -- gen_random_uuid()
create extension if not exists citext;       -- case-insensitive email

-- ─── Enums ────────────────────────────────────────────────────────────────────

create type plan_tier as enum ('free', 'starter', 'agency');

create type member_role as enum ('owner', 'admin', 'member');

create type project_provider as enum ('github');           -- source of code
create type db_provider as enum ('supabase');              -- backend DB (V1: Supabase only)

create type vuln_class as enum ('rls', 'secret', 'bola', 'auth');

create type severity as enum ('critical', 'high', 'medium', 'low');

-- Lifecycle of a single finding.
create type finding_status as enum (
  'open',           -- detected, not yet acted on
  'pr_opened',      -- remediation PR opened (rls, secret)
  'needs_review',   -- awaiting Kelp human validation (bola in MVP)
  'confirmed',      -- human-validated as real (bola)
  'resolved',       -- verified fixed on re-scan
  'regressed',      -- previously resolved, came back
  'dismissed'       -- user marked not-applicable / accepted risk
);

create type scan_status as enum ('queued', 'running', 'succeeded', 'failed', 'canceled');

create type scan_trigger as enum ('initial', 'manual', 'webhook_push', 'scheduled');

create type remediation_kind as enum (
  'rls_migration',  -- generated CREATE POLICY SQL, proposed as migration
  'secret_pr',      -- PR moving secret to env var
  'bola_review'     -- human-review request (no auto-fix in MVP)
);

create type remediation_status as enum ('proposed', 'pr_opened', 'applied', 'rejected', 'superseded');

-- ─── Tenancy: orgs, users, memberships ────────────────────────────────────────

create table orgs (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  plan               plan_tier not null default 'free',
  stripe_customer_id text unique,
  created_at         timestamptz not null default now()
);

-- Users are global identities (one person can belong to several orgs).
-- id is the auth subject (Supabase auth.users.id or Clerk user id).
create table users (
  id          uuid primary key,
  email       citext not null unique,
  created_at  timestamptz not null default now()
);
-- citext requires the extension; enable before the table on plain Postgres.
-- (Supabase ships citext; on vanilla PG add `create extension citext;` first.)

create table memberships (
  org_id     uuid not null references orgs(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  role       member_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index on memberships (user_id);

-- ─── Projects and their connections ───────────────────────────────────────────

create table projects (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references orgs(id) on delete cascade,
  name                 text not null,
  provider             project_provider not null default 'github',
  -- GitHub repo identity (nullable until connected).
  github_repo_full_name text,           -- "owner/repo"
  github_installation_id bigint,        -- GitHub App installation
  github_default_branch  text,
  -- Supabase backend identity (nullable until connected).
  db_provider          db_provider,
  supabase_project_ref text,            -- e.g. "abcdefgh"
  created_at           timestamptz not null default now(),
  archived_at          timestamptz
);

create index on projects (org_id);
create unique index on projects (org_id, github_repo_full_name)
  where github_repo_full_name is not null;

-- Encrypted customer credentials. Ciphertext only — encrypted at rest with
-- KELP_CREDENTIAL_ENC_KEY (app-side AEAD). We never store service_role keys if
-- a lower-privilege key suffices. token_kind documents the scope granted.
create table project_credentials (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  token_kind   text not null,          -- 'supabase_management' | 'github_installation'
  ciphertext   bytea not null,         -- AEAD-encrypted secret
  nonce        bytea not null,
  created_at   timestamptz not null default now(),
  rotated_at   timestamptz,
  unique (project_id, token_kind)
);

create index on project_credentials (org_id);

-- ─── Active-test (BOLA) consent — the hard legal gate ─────────────────────────
-- One current row per project. BOLA scanning reads this and refuses to run
-- unless consented = true AND revoked_at IS NULL. The exact consent copy the
-- user agreed to is stored verbatim for auditability.
create table active_test_consents (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  project_id    uuid not null references projects(id) on delete cascade,
  consented     boolean not null,
  consent_text  text not null,          -- exact wording shown at consent time
  consent_version text not null,        -- copy version, e.g. 'v1'
  consented_by  uuid not null references users(id),
  consented_at  timestamptz not null default now(),
  revoked_at    timestamptz,
  revoked_by    uuid references users(id)
);

-- Fast lookup for the guard: the current, non-revoked consent for a project.
create unique index one_active_consent_per_project
  on active_test_consents (project_id)
  where revoked_at is null;

-- User-provided test accounts for BOLA (MVP: user supplies them, we don't
-- create them). Credentials/sessions stored encrypted, same as other secrets.
create table bola_test_accounts (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  label        text not null,           -- 'account_a' | 'account_b'
  ciphertext   bytea not null,          -- encrypted credentials/session
  nonce        bytea not null,
  created_at   timestamptz not null default now(),
  unique (project_id, label)
);

-- ─── Scans and findings ───────────────────────────────────────────────────────

create table scans (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  status       scan_status not null default 'queued',
  trigger      scan_trigger not null,
  classes      vuln_class[] not null,   -- which classes this scan attempted
  queued_at    timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  error        text
);

create index on scans (project_id, queued_at desc);
create index on scans (org_id);

create table findings (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  project_id    uuid not null references projects(id) on delete cascade,
  -- The scan that first opened this finding; findings persist across re-scans.
  first_scan_id uuid not null references scans(id),
  last_scan_id  uuid not null references scans(id),
  vuln_class    vuln_class not null,
  severity      severity not null,
  status        finding_status not null default 'open',
  -- Stable identity so re-scans update the same finding instead of duplicating.
  -- e.g. hash of (class + table/file + rule). Set by the scanner.
  fingerprint   text not null,
  title         text not null,          -- short, human
  explanation   text not null,          -- plain-language: what it is / what's at risk
  -- Evidence WITHOUT customer end-user PII in clear text. For BOLA, proof of the
  -- flaw is described, not dumped. Raw third-party data must never land here.
  evidence      jsonb not null default '{}'::jsonb,
  location      text,                   -- table name, file path, or endpoint
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  unique (project_id, fingerprint)
);

create index on findings (project_id, status);
create index on findings (org_id);

-- Exposed END-USER personal data: category + count ONLY. Never raw values.
create table finding_exposure_summary (
  id           uuid primary key default gen_random_uuid(),
  finding_id   uuid not null references findings(id) on delete cascade,
  data_category text not null,          -- 'email', 'phone', 'name', ...
  record_count int not null check (record_count >= 0)
);

create index on finding_exposure_summary (finding_id);

create table remediations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  finding_id    uuid not null references findings(id) on delete cascade,
  kind          remediation_kind not null,
  status        remediation_status not null default 'proposed',
  -- For rls_migration: the generated SQL. For secret_pr: PR metadata.
  payload       jsonb not null default '{}'::jsonb,
  github_pr_url text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index on remediations (finding_id);
create index on remediations (org_id);

-- ─── Audit log — every access to customer data ────────────────────────────────
-- Append-only. Written whenever we read a customer's schema, code, credentials,
-- or run a test against their project.
create table audit_log (
  id          bigint generated always as identity primary key,
  org_id      uuid references orgs(id) on delete set null,
  project_id  uuid references projects(id) on delete set null,
  actor_type  text not null,            -- 'user' | 'worker' | 'system'
  actor_id    text,                     -- user id or worker/job id
  action      text not null,            -- 'read_schema', 'read_repo', 'bola_probe', ...
  resource    text,                     -- what was accessed
  metadata    jsonb not null default '{}'::jsonb,
  at          timestamptz not null default now()
);

create index on audit_log (org_id, at desc);
create index on audit_log (project_id, at desc);

commit;
