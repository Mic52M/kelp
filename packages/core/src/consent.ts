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
 * A consent is valid iff it exists, consented === true, and it is not revoked.
 */
export async function assertActiveTestConsent(
  store: ConsentStore,
  projectId: string,
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
  return consent;
}

/**
 * The ONLY sanctioned way to run an active (BOLA) test. It verifies consent,
 * writes an audit entry recording that the gated action started, then runs the
 * provided task. If consent is missing the task is never invoked.
 */
export async function runWithActiveTestConsent<T>(
  deps: { store: ConsentStore; audit: AuditLogger },
  ctx: { orgId: string; projectId: string; actorId: string; action: string },
  task: (consent: ActiveTestConsent) => Promise<T>,
): Promise<T> {
  const consent = await assertActiveTestConsent(deps.store, ctx.projectId);

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
