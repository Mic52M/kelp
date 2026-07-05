-- Extends the vuln_class enum with 'exposure' — runtime response leak of
-- sensitive fields (password hashes, salts, reset tokens, refresh tokens,
-- OTP secrets, etc.). Semantically distinct from the static 'secret' class
-- (which covers hard-coded credentials in source code): 'exposure' means the
-- endpoint's runtime response includes fields that should have been projected
-- away server-side. Different detection layer, different fix.
--
-- Kept in a dedicated migration because ALTER TYPE ... ADD VALUE cannot run
-- inside a transaction on Postgres.

alter type vuln_class add value if not exists 'exposure';
