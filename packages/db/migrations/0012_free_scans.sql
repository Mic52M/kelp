-- 0012 — Free (pre-signup) scans.
--
-- Top-of-funnel: anyone can drop a public GitHub repo URL on the landing page
-- and get a report without signing up. Since there is no org yet, these rows
-- do NOT carry org_id and are NOT covered by RLS — they are accessed only via
-- the service-role connection (Next server actions + worker). Row access is
-- gated by the un-guessable `slug` from the URL, or by `id` server-side.
--
-- When the user later hands us an email (magic link → account bootstrap), we
-- copy the free scan into their org's real `projects` / `scans` / `findings`
-- rows and set `claimed_by_org_id` here for the audit trail. The original
-- `free_scans` row is kept — it's the source of truth for /r/<slug> shareable
-- reports and for aggregate stats (State of Vibe-Coding Security).
--
-- The Supabase anon key is a PUBLIC key by Supabase design — safe to store
-- in plaintext. We still never log it and never proxy it to the browser.

begin;

create type free_scan_status as enum (
  'queued',    -- inserted, waiting for the worker
  'running',   -- picked up
  'succeeded', -- normal completion
  'capped',    -- hit the cost or time hard cap; partial results
  'failed'     -- unrecoverable error
);

create table free_scans (
  id uuid primary key default gen_random_uuid(),

  -- URL-safe short slug used in /r/<slug>. 10-char nanoid.
  slug text unique not null,

  -- Input.
  repo_url text not null,             -- canonical https://github.com/owner/repo
  supabase_url text,                  -- optional
  supabase_anon_key text,             -- optional, PUBLIC key by design (see header)

  -- Lifecycle.
  status free_scan_status not null default 'queued',
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  error text,

  -- Cost (mirrors scans.cost_cents). Deterministic v1 = 0.
  cost_cents integer not null default 0,

  -- Persisted results.
  --  findings: array of the DetectedFinding shape (title, class, severity,
  --            location, explanation, raw), server-filtered at read time.
  --  agent_report: same jsonb envelope as scans.agent_report — populated
  --                once the autonomous agent path (v2) lands. Null in v1.
  findings jsonb not null default '[]'::jsonb,
  agent_report jsonb,

  -- Reveal / claim.
  captured_email citext,
  captured_email_at timestamptz,
  claimed_by_org_id uuid references orgs(id) on delete set null,
  claimed_scan_id uuid,               -- points at scans.id after migration
  claimed_project_id uuid,            -- points at projects.id after migration
  claimed_at timestamptz,

  -- Abuse controls. IP hashed with FREE_SCAN_IP_PEPPER; raw IP never stored.
  ip_hash text not null,
  user_agent text,

  created_at timestamptz not null default now()
);

-- One completed report per canonicalized repo URL keeps the /r/<slug> for a
-- given repo stable and stops the same repo generating dozens of slugs when
-- shared. Enforced by the API (upsert on repo_url when status = 'succeeded').
create index free_scans_repo_url_idx on free_scans (repo_url);

-- Rate-limit lookups.
create index free_scans_ip_hash_created_at_idx on free_scans (ip_hash, created_at desc);

-- Public-report ordering + State of Vibe-Coding aggregations.
create index free_scans_created_at_idx on free_scans (created_at desc);

-- No RLS: this table is server-only. Explicitly deny broad access from the
-- browser role so a mistake in application code can't leak it.
revoke all on free_scans from public;
revoke all on free_scans from anon;
revoke all on free_scans from authenticated;

commit;
