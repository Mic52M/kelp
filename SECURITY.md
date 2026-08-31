# Security policy

Kelp is a security tool. We take vulnerabilities in Kelp itself as seriously as
the ones Kelp is built to find in customer code.

## Reporting a vulnerability

**Do not open a public GitHub issue for a vulnerability.** Report privately by
one of these channels:

- **Preferred**: GitHub Security Advisories — [open a private advisory](https://github.com/Mic52M/kelp/security/advisories/new).
- **Email**: `security@kelp.build` (please encrypt sensitive reproductions with
  our [PGP key](https://kelp.build/.well-known/pgp-key.txt) if you have one).

Please include:

1. A description of the vulnerability and its impact.
2. A reproduction — steps, screenshots, or a proof-of-concept commit/repo.
3. The Kelp component affected (CLI version, hosted app URL,
   `kelp-security/kelp-action@vX`, or a commit SHA of `Mic52M/kelp`).
4. Any suggested fix or mitigation you have in mind.

## What we commit to

- **Acknowledgement** within 3 business days.
- **Triage** (accepted / needs-more-info / not-a-vulnerability) within 7 days.
- **Fix or mitigation timeline** communicated within 14 days of triage.
- **Public disclosure** coordinated with you. We will credit you in the
  advisory unless you ask us not to.

## Scope

**In scope**:
- Any code in `Mic52M/kelp` (`apps/*`, `packages/*`).
- The hosted app at `kelp.build`.
- The GitHub Action at `kelp-security/kelp-action`.
- Kelp's own GitHub App (`kelp-security`) and its OAuth flow.

**Out of scope**:
- Findings *produced by* Kelp in customer code (report those to the customer,
  not to us).
- Rate-limits, best-practice suggestions, missing headers on marketing pages,
  or third-party dependencies without a specific exploitable chain.
- Social-engineering, physical access, or DoS from unauthenticated flooding.

## Safe harbor

We will not initiate legal action against researchers who:

- Make a good-faith effort to avoid privacy violations, service disruption, and
  data destruction.
- Only interact with test accounts they own, or accounts they have explicit
  permission to test.
- Give us reasonable time to fix before public disclosure.

## What Kelp itself does with security data

- Every finding Kelp produces is redacted at capture — secret values never
  leave the scanner boundary. Only masked previews (`sk_live_…`) reach the
  database.
- Customer credentials (Supabase read-only Postgres connection strings,
  GitHub App installation tokens) are encrypted at rest with `KELP_CREDENTIAL_ENC_KEY`
  before hitting `project_credentials`.
- Full threat model at [docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md).
