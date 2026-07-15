-- Persist the state of the auto-opened "Enable kelp/check" PR per project (#36 follow-up).
--
-- The PR is opened silently at connect time (Option A) and re-openable from
-- the dashboard (Option B). We track its state so:
--  - the dashboard renders the right button (Enable / PR-open / Enabled)
--  - repeated visits/reconnects don't spam duplicate PRs against the repo
--  - closing + re-opening from the dashboard is a distinct code path from
--    "we've already opened one before, reuse it"

alter table projects
  add column if not exists enable_check_pr_url text,
  add column if not exists enable_check_pr_opened_at timestamptz;

comment on column projects.enable_check_pr_url is
  'URL of the Kelp-opened PR that adds .github/workflows/kelp-check.yml. Null when we have not opened one (yet, or ever).';
comment on column projects.enable_check_pr_opened_at is
  'When the enable-check PR was opened. Cleared when the PR is confirmed merged (workflow file exists on default branch).';
