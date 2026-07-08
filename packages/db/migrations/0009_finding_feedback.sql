-- Finding feedback — the false-positive / resolved signal from users.
--
-- When a user marks a finding as a false positive, we record enough context to
-- analyse WHY a detector misfired (vuln class, rule/title, location, fingerprint)
-- without storing any secret value. This is the tuning loop for detection
-- precision — and, aggregated across the vibe-coding ecosystem, part of the
-- data moat ("which patterns generate the most false positives").
--
-- `kind` = 'false_positive' | 'resolved'. Scoped to the org (RLS) like every
-- other tenant table.

create table if not exists finding_feedback (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  finding_id   uuid not null references findings(id) on delete cascade,
  kind         text not null check (kind in ('false_positive', 'resolved')),
  vuln_class   text,
  rule_id      text,
  title        text,
  location     text,
  fingerprint  text,
  note         text,
  created_by   uuid,
  created_at   timestamptz not null default now()
);

create index if not exists idx_finding_feedback_org on finding_feedback(org_id);
create index if not exists idx_finding_feedback_kind on finding_feedback(kind);

alter table finding_feedback enable row level security;

-- Members of the org can read their own feedback; writes go through the worker's
-- service role (like findings), so no INSERT policy for the browser role.
drop policy if exists finding_feedback_select on finding_feedback;
create policy finding_feedback_select on finding_feedback
  for select using (
    org_id in (select org_id from memberships where user_id = auth.uid())
  );
