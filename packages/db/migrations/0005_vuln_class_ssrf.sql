-- Extends the vuln_class enum with 'ssrf' — the fourth class covered by
-- Kelp's pen-testing specialists (issue #20, phase 2 of #19). The `ssrf`
-- specialist confirms server-side-request-forgery by observing that the
-- target endpoint actually made a request to a URL only the specialist
-- knew about (an out-of-band callback listener the backend controls).
--
-- Kept in a dedicated migration because ALTER TYPE ... ADD VALUE cannot
-- run inside a transaction on Postgres.

alter type vuln_class add value if not exists 'ssrf';
