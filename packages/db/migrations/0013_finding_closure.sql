-- 0013 — Finding closure attribution + time-to-fix (#35).
--
-- Kelp already flips findings to `resolved` when a follow-up scan doesn't
-- re-detect them (see resolveMissingFindings) and when the user clicks
-- "Mark resolved". Neither path recorded WHO closed the finding, and neither
-- computed how long it stayed open. The pitch metric — median time-to-fix
-- on Kelp — needs both.
--
-- Additive-only: new columns are nullable, existing resolved rows keep NULL
-- attribution. The dashboard TTF tile filters on `time_to_fix_ms is not null`
-- so pre-migration data doesn't skew the median.

begin;

alter table findings
  add column if not exists resolved_by text
    check (resolved_by is null or resolved_by in ('user', 'auto')),
  add column if not exists time_to_fix_ms bigint
    check (time_to_fix_ms is null or time_to_fix_ms >= 0);

-- The TTF tile queries active-org × severity × recent-window. Indexing on
-- (org_id, severity) where time_to_fix_ms is populated keeps that fast even
-- once resolved rows accumulate.
create index if not exists findings_ttf_idx
  on findings (org_id, severity)
  where time_to_fix_ms is not null;

commit;
