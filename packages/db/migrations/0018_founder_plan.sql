-- Founder tier: internal-only, unlimited-everything plan for the Kelp team.
-- Not sold, not listed in the pricing page — the assertion helpers in
-- packages/core/src/plans.ts treat this like Agency-plus with no project cap.
--
-- Rationale: even the "Agency" tier caps at 25 projects, which is fine for a
-- customer segment but hits the founder mid-demo when connecting personal
-- test repos alongside real customer accounts.

alter type plan_tier add value if not exists 'founder';
