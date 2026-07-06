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

// ─── Consent versions (issue #24) ────────────────────────────────────────────
//
// v1 = BOLA-only wording, kept for backward compatibility so an existing single-
// class run never breaks. v2 = multi-specialist wording that enumerates every
// enabled class, the concurrency ceiling, and the data-hygiene guarantees. The
// multi-agent campaign (issue #19) requires v2; a single-class BOLA test still
// accepts either.

/** Current latest consent copy version. Bump when the copy changes materially. */
export const CONSENT_VERSION_LATEST = "v2" as const;

/** The verbatim copy the user must agree to for a v2 (multi-specialist) run.
 *  Stored on the consent row as `consent_text` for audit — if the copy changes,
 *  the version bumps and a fresh accept is required. */
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

/** Campaigns tell the guard which versions they accept. The multi-specialist
 *  campaign requires v2; a legacy BOLA-only run accepts either. */
export const CONSENT_ACCEPTED_FOR_MULTI_SPECIALIST = ["v2"] as const;
export const CONSENT_ACCEPTED_FOR_BOLA_ONLY = ["v1", "v2"] as const;

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
