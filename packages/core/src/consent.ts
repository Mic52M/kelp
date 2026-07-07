// Active-test (BOLA) consent guard.
//
// LEGAL INVARIANT (from the product brief): the BOLA module — which performs
// active, unauthorized-access-simulating tests against the customer's project —
// MUST NOT run unless the customer has given explicit, non-revoked consent for
// that specific project. This file is the single technical chokepoint that
// enforces it. Every BOLA code path must go through runWithActiveTestConsent();
// the scanner has no other entry point.
//
// The guard is dependency-injected (ConsentStore + AuditLogger) so it is trivial
// to unit-test and is not tied to a particular DB client.

import type { ActiveTestConsent } from "./types.js";

// ─── Consent versions ────────────────────────────────────────────────────────
//
// v1 = BOLA-only wording. v2 = first multi-specialist copy (issue #24).
// v3 = multi-specialist copy expanded with a Representations block, an explicit
// authorization warranty, a limitation-of-liability clause, and a governing-
// terms line — the material additions that make the record more defensible in
// a dispute. Any material copy change bumps the version and forces a fresh
// accept (assertActiveTestConsent enforces this via the version allow-list).
//
// IMPORTANT (legal): the text below is a template written for developer
// convenience, not legal advice. Review with counsel before shipping to
// regulated jurisdictions or high-risk customers.

/** Current latest consent copy version. Bump when the copy changes materially. */
export const CONSENT_VERSION_LATEST = "v3" as const;

/** Legacy v2 copy — retained so existing v2 acceptances are still parseable
 *  from the DB, but new campaigns require v3. Do not modify. */
export const CONSENT_V2_TEXT = `Kelp will run active security tests against your connected project. \
By continuing you consent to the following:

1. TESTS PERFORMED. Kelp will run automated probes for the enabled classes:
   BOLA (cross-account object access), broken authentication, injection
   (SQL / NoSQL / command), SSRF, RLS-deep policy testing, insecure direct
   data exposure, and weak crypto / weak session detection.

2. LIVE REQUESTS. Your app will receive live HTTP requests during the
   campaign. Up to four (4) specialist agents may run in parallel.

3. DATA HYGIENE. Kelp records vulnerability descriptions and reproduction
   steps only. End-user data encountered during probes is stored as
   category + count (never raw values). Third-party account tokens or
   session cookies are never persisted in cleartext. Every probe is written
   to your audit_log.

4. REVOCATION. You can revoke this consent from Settings at any time.
   Kelp will refuse further active tests immediately.

5. NO FINDING WITHOUT EVIDENCE. Kelp will not report a vulnerability unless
   a real probe confirmed the flaw. Model output alone never produces a
   finding.`;

/** Verbatim copy the user must agree to for a v3 (multi-specialist) run. */
export const CONSENT_V3_TEXT = `ACTIVE SECURITY TESTING AUTHORIZATION — Kelp

By clicking "Accept and grant consent" you authorize Kelp Security ("Kelp") to
perform active security testing against the project you have selected in
Kelp Settings ("the Project"). This authorization ("Consent") is recorded
with a UTC timestamp, the identifier of the accepting user, and the exact
version of this text, and is stored in Kelp's audit log until you revoke it.

1. SCOPE OF TESTING
   Kelp will run automated, agentic probes for the following vulnerability
   classes: broken object-level authorization (BOLA); broken authentication
   and session-identity bypass; injection (SQL / NoSQL / command);
   server-side request forgery (SSRF); row-level security policy testing
   (RLS-deep); insecure direct data exposure via response-body field names;
   and weak session-cookie configuration (weak crypto). Kelp will not
   attempt destructive actions (no DROP, DELETE, or modification of your
   data). Kelp will not attempt denial-of-service, privilege escalation on
   the host, or any test outside the classes listed above.

2. LIVE HTTP TRAFFIC
   Your app will receive live HTTP requests during the campaign. Up to four
   (4) specialist agents may run concurrently. Requests originate from Kelp
   infrastructure and are attributed to Kelp in the User-Agent. If you
   maintain a staging environment, we recommend pointing Kelp's "app URL"
   there rather than at production.

3. DATA HYGIENE
   Kelp records vulnerability descriptions and reproduction steps only. When
   an end-user's data is encountered during a probe, Kelp stores it as a
   category and a count — never the raw value. Third-party account tokens,
   session cookies, and access credentials Kelp encounters during a probe
   are never persisted in cleartext; only the presence of a flaw is
   recorded. Every probe writes a row to your audit_log so you can inspect
   what happened after the fact.

4. NO FINDING WITHOUT CONFIRMED EVIDENCE
   Kelp will not report a vulnerability unless a deterministic probe
   confirmed the flaw. Language-model output alone never produces a
   finding — the tool-boundary in Kelp's engine refuses to record a
   report_finding call that lacks matching probe evidence.

5. REPRESENTATIONS
   You represent and warrant that:
   (a) you have full authority to authorize security testing of the Project,
       including on behalf of any organization that owns or operates it;
   (b) the Project's terms of service (from your hosting provider, database
       provider, and any third parties whose services the Project calls)
       do not prohibit third-party security testing, or you have obtained
       the necessary permissions;
   (c) the Project does not process regulated end-user data (PHI under
       HIPAA; card data under PCI-DSS; equivalent EU/UK special-category
       data under GDPR Art. 9) in a manner that would render live probes
       unlawful without additional safeguards you have separately obtained;
   (d) if the Project processes personal data of end users, you have a
       lawful basis under applicable data-protection law (e.g. GDPR Art. 6
       legitimate interests / contractual necessity) for Kelp to perform
       this testing; and
   (e) you will not use Kelp to test any system you do not have authority
       to test.

6. LIMITATION OF LIABILITY
   Kelp performs testing in good faith and within the scope above. To the
   maximum extent permitted by applicable law, Kelp is not liable for:
   pre-existing vulnerabilities the campaign discloses; incidental
   downtime, performance degradation, or increased infrastructure cost
   caused by legitimate probe traffic; or third-party actions taken in
   response to probe traffic (e.g. rate-limiting, IP bans). Nothing in
   this section limits liability that cannot be limited under applicable
   law (including liability for gross negligence, wilful misconduct, or
   personal injury).

7. REVOCATION
   You may revoke this Consent at any time from Kelp Settings. Revocation
   takes effect immediately: further active campaigns for the Project will
   refuse to start until you re-accept. Revocation does not undo
   completed probes or delete their audit rows — those are retained as the
   record of what Kelp did while consent was in force.

8. RETENTION AND DOWNLOAD
   You may download a copy of this Consent, together with the accepting
   user, organization, timestamp, and version, from Kelp Settings at any
   time. Kelp retains the acceptance record for at least the lifetime of
   the Project inside Kelp.

9. GOVERNING TERMS
   This Consent supplements — and does not replace — the Kelp Terms of
   Service you accepted at sign-up. In the event of a conflict, the more
   specific of the two governs the disputed matter. If you have not
   otherwise agreed to Kelp Terms of Service, this Consent is void.

10. ACCEPTANCE
    By clicking "Accept and grant consent" you (a) confirm you have read
    and understood this authorization, (b) affirm the representations in
    Section 5 as of the timestamp recorded on the acceptance, and (c)
    grant Kelp the permissions described in Sections 1–4. Kelp's record
    of this click, together with the user identifier, timestamp, and
    version stored in audit_log, is the definitive record of your
    acceptance.`;

/** Campaigns tell the guard which versions they accept. The multi-specialist
 *  campaign requires v3 (the latest); a legacy BOLA-only run still accepts
 *  older versions so an existing v1 or v2 acceptance isn't invalidated for
 *  the narrow single-class path. */
export const CONSENT_ACCEPTED_FOR_MULTI_SPECIALIST = ["v3"] as const;
export const CONSENT_ACCEPTED_FOR_BOLA_ONLY = ["v1", "v2", "v3"] as const;

/** Thrown when a BOLA test is attempted without valid, non-revoked consent. */
export class ConsentRequiredError extends Error {
  readonly code = "CONSENT_REQUIRED";
  readonly projectId: string;
  constructor(projectId: string, reason: string) {
    super(`Active-test consent missing for project ${projectId}: ${reason}`);
    this.name = "ConsentRequiredError";
    this.projectId = projectId;
  }
}

export interface ConsentStore {
  /** Returns the current consent row for a project, or null if none exists. */
  getActiveTestConsent(projectId: string): Promise<ActiveTestConsent | null>;
}

export interface AuditLogger {
  record(entry: {
    orgId: string;
    projectId: string;
    actorType: "user" | "worker" | "system";
    actorId: string;
    action: string;
    resource?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

/**
 * Returns the consent if it is valid to run active tests, otherwise throws.
 * A consent is valid iff it exists, consented === true, is not revoked, AND
 * (when `acceptedVersions` is passed) its stored version is on that list.
 *
 * `acceptedVersions` is optional so legacy call sites keep working — but the
 * multi-specialist campaign passes `CONSENT_ACCEPTED_FOR_MULTI_SPECIALIST`
 * to require a fresh v2 accept, per issue #24.
 */
export async function assertActiveTestConsent(
  store: ConsentStore,
  projectId: string,
  opts?: { acceptedVersions?: readonly string[] },
): Promise<ActiveTestConsent> {
  const consent = await store.getActiveTestConsent(projectId);
  if (!consent) {
    throw new ConsentRequiredError(projectId, "no consent record");
  }
  if (consent.revokedAt !== null) {
    throw new ConsentRequiredError(projectId, "consent revoked");
  }
  if (consent.consented !== true) {
    throw new ConsentRequiredError(projectId, "consent not granted");
  }
  if (opts?.acceptedVersions && !opts.acceptedVersions.includes(consent.consentVersion)) {
    throw new ConsentRequiredError(
      projectId,
      `consent version ${consent.consentVersion} not accepted (need one of: ${opts.acceptedVersions.join(", ")})`,
    );
  }
  return consent;
}

/**
 * The ONLY sanctioned way to run an active (BOLA) test. It verifies consent,
 * writes an audit entry recording that the gated action started, then runs the
 * provided task. If consent is missing the task is never invoked.
 */
export async function runWithActiveTestConsent<T>(
  deps: { store: ConsentStore; audit: AuditLogger },
  ctx: {
    orgId: string;
    projectId: string;
    actorId: string;
    action: string;
    /** Optional per-campaign version requirement (see #24). */
    acceptedVersions?: readonly string[];
  },
  task: (consent: ActiveTestConsent) => Promise<T>,
): Promise<T> {
  const consent = await assertActiveTestConsent(deps.store, ctx.projectId, {
    ...(ctx.acceptedVersions !== undefined ? { acceptedVersions: ctx.acceptedVersions } : {}),
  });

  await deps.audit.record({
    orgId: ctx.orgId,
    projectId: ctx.projectId,
    actorType: "worker",
    actorId: ctx.actorId,
    action: ctx.action,
    metadata: {
      consentVersion: consent.consentVersion,
      consentedBy: consent.consentedBy,
      consentedAt: consent.consentedAt.toISOString(),
    },
  });

  return task(consent);
}
