-- Extends the vuln_class enum with 'injection' — the third class covered by
-- Kelp's pen-testing specialists (issue #19 phase 2). The `injection` specialist
-- confirms SQL/NoSQL-injection-shaped bypasses by observing that a payload
-- widens a query's result set beyond what the baseline returned.
--
-- Kept in a dedicated migration because ALTER TYPE ... ADD VALUE cannot run
-- inside a transaction on Postgres (and this file is intentionally not wrapped
-- in begin/commit).

alter type vuln_class add value if not exists 'injection';
