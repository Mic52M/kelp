import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertActiveTestConsent,
  runWithActiveTestConsent,
  ConsentRequiredError,
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
