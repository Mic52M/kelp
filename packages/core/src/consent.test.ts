import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertActiveTestConsent,
  runWithActiveTestConsent,
  ConsentRequiredError,
  CONSENT_ACCEPTED_FOR_MULTI_SPECIALIST,
  CONSENT_ACCEPTED_FOR_BOLA_ONLY,
  type ConsentStore,
  type AuditLogger,
} from "./consent.js";
import type { ActiveTestConsent } from "./types.js";

function storeReturning(consent: ActiveTestConsent | null): ConsentStore {
  return { getActiveTestConsent: async () => consent };
}

function recordingAudit(): AuditLogger & { calls: unknown[] } {
  const calls: unknown[] = [];
  return { calls, record: async (e) => void calls.push(e) };
}

const valid: ActiveTestConsent = {
  projectId: "p1",
  orgId: "o1",
  consented: true,
  consentVersion: "v1",
  consentedBy: "u1",
  consentedAt: new Date("2026-07-02T00:00:00Z"),
  revokedAt: null,
};

test("assert passes with a valid, non-revoked consent", async () => {
  const c = await assertActiveTestConsent(storeReturning(valid), "p1");
  assert.equal(c.projectId, "p1");
});

test("assert rejects when no consent record exists", async () => {
  await assert.rejects(
    () => assertActiveTestConsent(storeReturning(null), "p1"),
    (e) => e instanceof ConsentRequiredError,
  );
});

test("assert rejects a revoked consent", async () => {
  await assert.rejects(
    () =>
      assertActiveTestConsent(
        storeReturning({ ...valid, revokedAt: new Date() }),
        "p1",
      ),
    (e) => e instanceof ConsentRequiredError,
  );
});

test("assert rejects consented=false", async () => {
  await assert.rejects(
    () =>
      assertActiveTestConsent(storeReturning({ ...valid, consented: false }), "p1"),
    (e) => e instanceof ConsentRequiredError,
  );
});

test("runWithActiveTestConsent never runs the task without consent", async () => {
  const audit = recordingAudit();
  let ran = false;
  await assert.rejects(
    () =>
      runWithActiveTestConsent(
        { store: storeReturning(null), audit },
        { orgId: "o1", projectId: "p1", actorId: "job1", action: "bola_probe" },
        async () => {
          ran = true;
          return "should-not-happen";
        },
      ),
    (e) => e instanceof ConsentRequiredError,
  );
  assert.equal(ran, false, "task must not run");
  assert.equal(audit.calls.length, 0, "no audit entry when blocked");
});

// ─── Consent versioning (#24, bumped to v3) ──────────────────────────────────

const v1: ActiveTestConsent = { ...valid, consentVersion: "v1" };
const v2: ActiveTestConsent = { ...valid, consentVersion: "v2" };
const v3: ActiveTestConsent = { ...valid, consentVersion: "v3" };

test("multi-specialist campaign rejects a v1 (BOLA-only) consent", async () => {
  await assert.rejects(
    () =>
      assertActiveTestConsent(storeReturning(v1), "p1", {
        acceptedVersions: CONSENT_ACCEPTED_FOR_MULTI_SPECIALIST,
      }),
    (e) => e instanceof ConsentRequiredError && /not accepted/.test((e as Error).message),
  );
});

test("multi-specialist campaign rejects a v2 consent (v3 required)", async () => {
  await assert.rejects(
    () =>
      assertActiveTestConsent(storeReturning(v2), "p1", {
        acceptedVersions: CONSENT_ACCEPTED_FOR_MULTI_SPECIALIST,
      }),
    (e) => e instanceof ConsentRequiredError && /not accepted/.test((e as Error).message),
  );
});

test("multi-specialist campaign accepts a v3 consent", async () => {
  const c = await assertActiveTestConsent(storeReturning(v3), "p1", {
    acceptedVersions: CONSENT_ACCEPTED_FOR_MULTI_SPECIALIST,
  });
  assert.equal(c.consentVersion, "v3");
});

test("BOLA-only campaign accepts v1, v2, or v3 (v3 is a superset)", async () => {
  const a = await assertActiveTestConsent(storeReturning(v1), "p1", {
    acceptedVersions: CONSENT_ACCEPTED_FOR_BOLA_ONLY,
  });
  const b = await assertActiveTestConsent(storeReturning(v2), "p1", {
    acceptedVersions: CONSENT_ACCEPTED_FOR_BOLA_ONLY,
  });
  const c = await assertActiveTestConsent(storeReturning(v3), "p1", {
    acceptedVersions: CONSENT_ACCEPTED_FOR_BOLA_ONLY,
  });
  assert.equal(a.consentVersion, "v1");
  assert.equal(b.consentVersion, "v2");
  assert.equal(c.consentVersion, "v3");
});

test("runWithActiveTestConsent runs the task and audits when consented", async () => {
  const audit = recordingAudit();
  const result = await runWithActiveTestConsent(
    { store: storeReturning(valid), audit },
    { orgId: "o1", projectId: "p1", actorId: "job1", action: "bola_probe" },
    async (c) => `ran:${c.projectId}`,
  );
  assert.equal(result, "ran:p1");
  assert.equal(audit.calls.length, 1, "one audit entry recorded");
});
