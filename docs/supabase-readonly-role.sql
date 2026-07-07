-- Kelp — read-only Supabase Postgres role (issue #5).
--
-- Run this ONCE against your Supabase project's database (SQL editor in the
-- Supabase dashboard, or psql with the built-in `postgres` role). It creates
-- a `kelp_readonly` role that can ONLY read the catalog information Kelp's
-- RLS analyzer needs (table list, columns, policies). It CANNOT read your
-- application data.
--
-- After running this you'll be prompted in Kelp Settings for a connection
-- string. Paste the **Session pooler** URL from Supabase → Project Settings →
-- Database → Connect → "Session pooler", AS-IS (no manual rewrites):
--
--   postgres://postgres.<project-ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres
--
-- Kelp connects as postgres and then issues `SET ROLE kelp_readonly` at
-- session start, so the URL keeps the standard `postgres.<ref>` username
-- Supavisor knows how to route.
--
-- DO NOT use the "Direct connection" (db.<ref>.supabase.co) URL — it's
-- IPv6-only for new projects and most networks (Vercel/Railway/dev machines)
-- reject it with ENOTFOUND.
--
-- Rotate: `alter role kelp_readonly with password '<new-password>';` and
-- reconnect from Kelp Settings.
--
-- Revoke: `drop role kelp_readonly;` (Kelp scans will stop immediately with a
-- clear "credentials rejected" banner in the dashboard).

-- ── Create the role with a password you choose. Replace <PICK_A_STRONG_PW>. ──
create role kelp_readonly with login password '<PICK_A_STRONG_PW>';

-- ── Minimum permissions Kelp needs ──────────────────────────────────────────
-- 1. Connect to the database.
grant connect on database postgres to kelp_readonly;

-- 2. See the public schema (does NOT include any read on tables — RLS still
--    applies, and Kelp doesn't try to read them anyway).
grant usage on schema public to kelp_readonly;

-- 3. Read the Postgres catalog. This is the source of truth for the RLS
--    analyzer: it enumerates tables/views/materialized views, their columns,
--    whether RLS is enabled, and every policy attached.
--    NOTE we read COLUMNS from pg_attribute, NOT information_schema.columns —
--    the latter is privilege-filtered and returns nothing for a role with no
--    table privileges (which is exactly what kelp_readonly is by design).
grant usage on schema pg_catalog to kelp_readonly;
grant select on pg_catalog.pg_class      to kelp_readonly;
grant select on pg_catalog.pg_namespace  to kelp_readonly;
grant select on pg_catalog.pg_policies   to kelp_readonly;
grant select on pg_catalog.pg_attribute  to kelp_readonly;
grant select on pg_catalog.pg_type       to kelp_readonly;

-- ── Explicitly deny what Kelp doesn't need ──────────────────────────────────
-- Belt-and-braces: revoke default privileges so a future public-schema
-- migration doesn't accidentally grant kelp_readonly access to a new table.
alter default privileges in schema public revoke select on tables from kelp_readonly;

-- ── Let the standard 'postgres' user switch to this role at session start ──
-- The customer's Session-pooler URL authenticates as `postgres`. Kelp then
-- issues `SET ROLE kelp_readonly` — that requires postgres to be a member.
grant kelp_readonly to postgres;

-- Nothing else. No CREATE, no INSERT/UPDATE/DELETE anywhere.
