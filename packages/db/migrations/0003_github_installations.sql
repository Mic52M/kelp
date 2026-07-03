-- GitHub App installations, per org (issue #14).
--
-- Before this, the connect flow listed repos from a single
-- GITHUB_APP_INSTALLATION_ID in env (the founder's install). For real
-- multi-user, each org installs the Kelp GitHub App on their own account/org;
-- we capture the installation_id in the post-install callback and store it here.
-- One org can have several installations (a personal account + an org they
-- admin), so this is a one-to-many from orgs.

begin;

create table if not exists github_installations (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references orgs(id) on delete cascade,
  installation_id  bigint not null unique,   -- GitHub's numeric installation id
  account_login    text,                     -- "octocat" / "acme-inc"
  account_type     text,                     -- 'User' | 'Organization'
  connected_by     uuid references users(id),
  created_at       timestamptz not null default now(),
  revoked_at       timestamptz               -- set when uninstalled/disconnected
);

create index if not exists github_installations_org_idx
  on github_installations (org_id)
  where revoked_at is null;

-- Backfill: any project already carrying an installation id predates this table.
-- Register those installations so existing orgs (incl. the demo account) keep
-- working through the new per-org listing without re-installing.
insert into github_installations (org_id, installation_id)
select distinct org_id, github_installation_id
from projects
where github_installation_id is not null
on conflict (installation_id) do nothing;

-- RLS: a user sees an org's installations only if they are a member. The worker
-- role bypasses RLS (operates across tenants), same as every other table.
alter table github_installations enable row level security;

drop policy if exists github_installations_member on github_installations;
create policy github_installations_member on github_installations
  for select using (kelp_is_member(org_id));

commit;
