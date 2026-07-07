import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLANS,
  PlanLimitError,
  assertActivePentestAvailable,
  assertAutoFixAvailable,
  assertCanCreateProject,
  assertCanTriggerRescan,
} from "./plans.js";

test("free tier: first project succeeds (the PLG aha-moment must never break)", () => {
  assert.doesNotThrow(() => assertCanCreateProject("free", 0));
});

test("free tier: second project refused with PROJECT_LIMIT_REACHED", () => {
  assert.throws(
    () => assertCanCreateProject("free", 1),
    (e): e is PlanLimitError => e instanceof PlanLimitError && e.code === "PROJECT_LIMIT_REACHED",
  );
});

test("starter tier: allows more projects than free", () => {
  // Sanity check that plan config differs — not a specific number so tuning
  // the caps in one place doesn't break tests.
  assert.ok(PLANS.starter.maxProjects > PLANS.free.maxProjects);
  assert.ok(PLANS.agency.maxProjects > PLANS.starter.maxProjects);
});

test("free tier: manual re-scan allowed (user clicked the button)", () => {
  assert.doesNotThrow(() => assertCanTriggerRescan("free", "manual"));
});

test("free tier: webhook_push refused (continuous scanning is paid)", () => {
  assert.throws(
    () => assertCanTriggerRescan("free", "webhook_push"),
    (e): e is PlanLimitError => e instanceof PlanLimitError && e.code === "RESCAN_TRIGGER_NOT_ALLOWED",
  );
});

test("starter tier: webhook_push allowed", () => {
  assert.doesNotThrow(() => assertCanTriggerRescan("starter", "webhook_push"));
});

test("free tier: auto-fix refused", () => {
  assert.throws(
    () => assertAutoFixAvailable("free"),
    (e): e is PlanLimitError => e instanceof PlanLimitError && e.code === "AUTO_FIX_NOT_AVAILABLE",
  );
});

test("starter+agency: auto-fix allowed", () => {
  assert.doesNotThrow(() => assertAutoFixAvailable("starter"));
  assert.doesNotThrow(() => assertAutoFixAvailable("agency"));
});

test("free tier: active pen-test refused", () => {
  assert.throws(
    () => assertActivePentestAvailable("free"),
    (e): e is PlanLimitError => e instanceof PlanLimitError && e.code === "ACTIVE_PENTEST_NOT_AVAILABLE",
  );
});

test("PlanLimitError carries plan + stable code (UI can branch on it)", () => {
  try {
    assertCanCreateProject("free", 999);
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(e instanceof PlanLimitError);
    assert.equal(e.plan, "free");
    assert.equal(e.code, "PROJECT_LIMIT_REACHED");
    assert.match(e.message, /Free/);
  }
});
