-- Issue #25 (part of #19 phase 3): per-scan Claude cost accounting.
--
-- Active-pentest campaigns run 5–7 Claude specialists in parallel; per-project
-- cost can vary by 10× depending on how many probes each specialist runs. To
-- enforce per-plan monthly caps (packages/core/src/agent/pricing.ts) and to
-- show the user roughly what a scan cost, every scan now records the Claude
-- spend attributable to it.
--
-- Rounding: cost_cents is an integer of USD-cents (US$1 = 100). Fractional
-- cents from token math are Math.round()-ed in code before the write.
--
-- Nullable: deterministic scans (secret/rls) never touch Claude and stay NULL,
-- which the UI/reporting can render as "—" rather than "$0.00" (distinct from
-- a $0 pentest campaign that ran but reported zero usage).

alter table scans add column if not exists cost_cents integer;
