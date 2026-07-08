-- Scan agent report — persist the autonomous-agent CampaignReport per scan.
--
-- The scan-processor already produces a rich report per active-pentest run
-- (per-agent transcript, tool-call counts, steps, cost, findings). Until now
-- we threw the transcript away after upserting findings, so the user had no
-- way to see WHAT the pen test actually did. Storing it here powers the
-- "How the pen test ran" panel (per-agent expander with reasoning steps),
-- which is what turns a "0 findings" result from "did anything happen?"
-- into "here's exactly what the three agents tried and why nothing broke".
--
-- Shape: the CampaignReport JSON as produced by @kelp/core/agent/orchestrator
-- (outcomes[]: name, vulnClass, steps, transcript[], usage, error, findings).
-- Redacted before insert — the transcript already excludes raw user data by
-- design (the toolbox redacts HTTP bodies), so persistence is safe.

alter table scans add column if not exists agent_report jsonb;
