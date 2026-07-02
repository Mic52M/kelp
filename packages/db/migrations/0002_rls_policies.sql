-- Row-Level Security: tenant isolation on Kelp's own database.
-- The web app connects as the Supabase "authenticated" role, so every query is
-- automatically scoped to the caller's orgs. The worker uses a privileged role
-- that BYPASSES RLS (it operates across tenants by design) and is never exposed
-- to the browser.
--
-- Auth model: Supabase Auth. auth.uid() is the current user's id, which matches
-- users.id / memberships.user_id. If you switch to Clerk, replace kelp_current_user()
-- with a function that reads the verified user id from the JWT claims.

begin;

-- Current authenticated user id (NULL for the service/worker role).
create or replace function kelp_current_user() returns uuid
  language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
$$;

-- Is the current user a member of the given org?
create or replace function kelp_is_member(target_org uuid) returns boolean
  language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from memberships m
    where m.org_id = target_org
      and m.user_id = kelp_current_user()
  );
$$;

-- Enable RLS on every tenant table.
alter table orgs                     enable row level security;
alter table memberships              enable row level security;
alter table projects                 enable row level security;
alter table project_credentials      enable row level security;
alter table active_test_consents     enable row level security;
alter table bola_test_accounts       enable row level security;
alter table scans                    enable row level security;
alter table findings                 enable row level security;
alter table finding_exposure_summary enable row level security;
alter table remediations             enable row level security;
alter table audit_log                enable row level security;

-- orgs: a user sees an org only if they are a member.
create policy org_member_read on orgs
  for select using (kelp_is_member(id));

-- memberships: a user sees membership rows for orgs they belong to.
create policy membership_read on memberships
  for select using (kelp_is_member(org_id));

-- Generic tenant tables scoped by org_id. Read-only from the browser for
-- security-sensitive tables; writes go through the worker / server actions
-- running with elevated privileges, so we grant SELECT here and keep mutations
-- server-side.
create policy projects_member on projects
  for select using (kelp_is_member(org_id));

create policy scans_member on scans
  for select using (kelp_is_member(org_id));

create policy findings_member on findings
  for select using (kelp_is_member(org_id));

create policy remediations_member on remediations
  for select using (kelp_is_member(org_id));

create policy consents_member on active_test_consents
  for select using (kelp_is_member(org_id));

-- exposure summary is reachable via its finding's org.
create policy exposure_member on finding_exposure_summary
  for select using (
    exists (
      select 1 from findings f
      where f.id = finding_exposure_summary.finding_id
        and kelp_is_member(f.org_id)
    )
  );

-- Credentials and test accounts hold secrets: NEVER selectable from the browser
-- role. RLS is enabled with no permissive SELECT policy, so the authenticated
-- role sees nothing; only the worker role (RLS-bypassing) can read them.
-- (No policy = default deny.)

-- audit_log: readable by org members, append-only (no update/delete policy).
create policy audit_member_read on audit_log
  for select using (kelp_is_member(org_id));

commit;
