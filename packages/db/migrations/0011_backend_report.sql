-- 0011 — backend_report on projects
--
-- Kelp analyzes a connected repo on connect and produces a `BackendReport`
-- (see packages/core/src/agent/analyze-backend.ts). Store the whole brief
-- on the project row so the Configuration page can adapt to what the app
-- actually runs on (Supabase / Firebase / Convex / custom / unknown)
-- without re-analyzing on every render.
--
-- Never contains secrets. Contains only PUBLIC keys and URLs that were
-- already committed to the customer's repo — this is the same class of
-- data the app's browser bundle exposes.

alter table projects
  add column if not exists backend_report jsonb;
