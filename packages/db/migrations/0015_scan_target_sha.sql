-- Scan against an arbitrary git ref, not just the default branch tip (#36).
--
-- Until now every scan implicitly targeted the default branch (the tarball
-- endpoint is called without ?ref). For the GitHub Action `kelp/check` we
-- need to scan the exact PR head SHA, and later compare its findings to the
-- most recent scan of the PR's base SHA (usually main) to gate the merge on
-- NEW high/critical findings only.
--
-- Both columns are nullable — existing scans (all legacy rows + all manual
-- rescans) don't carry a target SHA, and the processor keeps its current
-- "fetch default branch" behavior when head_sha is null.

alter table scans
  add column if not exists head_sha text,
  add column if not exists base_sha text;

comment on column scans.head_sha is
  'Git SHA the scan targeted. Null = default-branch tip at scan time.';
comment on column scans.base_sha is
  'For PR-triggered scans, the base ref SHA. Used to diff-against-main and flag findings NEW since base.';

-- New scan_trigger value for scans enqueued by the kelp/check GitHub Action.
-- ADD VALUE cannot run inside a transaction on some Postgres versions; keep
-- IF NOT EXISTS so re-applying the file is safe.
alter type scan_trigger add value if not exists 'pr_check';
