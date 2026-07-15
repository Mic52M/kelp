-- kelp/check GitHub Action follow-up (#36, Phase 2).
--
-- When a PR-triggered scan finishes we need to post a comment on the PR
-- itself. The worker already knows the repo (via projects.github_repo_full_name)
-- and installation id (via projects.github_installation_id), but not which
-- PR to comment on. Persist the PR number on the scan row when the Action
-- enqueues it so the worker can find its way back after finish.

alter table scans
  add column if not exists pr_number integer;

comment on column scans.pr_number is
  'PR number for kelp/check (#36) scans — the PR to post the results comment to. Null for every other scan.';
