import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { campaignFindingsToDetected } from "./campaign-findings.js";

describe("campaignFindingsToDetected", () => {
  it("maps each specialist's Report into a DetectedFinding row", () => {
    const detected = campaignFindingsToDetected([
      {
        name: "bola",
        vulnClass: "bola",
        findings: [
          {
            fingerprint: "fp-bola-1",
            severity: "high",
            title: "cross-account access on /api/orders",
            evidence: "A read B's order",
            endpoint: "GET /api/orders/:id",
          },
        ],
      },
      {
        name: "rls-deep",
        vulnClass: "rls",
        findings: [
          {
            fingerprint: "fp-rls-1",
            severity: "critical",
            title: "orders_public leaks",
            evidence: "A read rows owned by B",
            table: "public.orders_public",
          },
        ],
      },
      {
        name: "auth-bypass",
        vulnClass: "auth",
        findings: [], // empty outcome — must not produce a row
      },
    ]);

    assert.equal(detected.length, 2);
    assert.equal(detected[0]?.vulnClass, "bola");
    assert.equal(detected[0]?.location, "GET /api/orders/:id");
    assert.equal(detected[0]?.severity, "high");
    assert.equal(detected[0]?.fixable, false);
    assert.equal(detected[1]?.vulnClass, "rls");
    assert.equal(detected[1]?.location, "public.orders_public");
    // Class-specific payload is preserved in raw for the UI to render.
    assert.equal(
      (detected[1]?.raw as { table?: string }).table,
      "public.orders_public",
    );
  });

  it("returns [] when there are no outcomes at all", () => {
    assert.deepEqual(campaignFindingsToDetected([]), []);
  });

  it("falls back to null location when the report has neither endpoint nor table", () => {
    const detected = campaignFindingsToDetected([
      {
        name: "exposure",
        vulnClass: "exposure",
        findings: [
          {
            fingerprint: "fp-exp-1",
            severity: "medium",
            title: "sensitive field",
            evidence: "found password_hash",
          },
        ],
      },
    ]);
    assert.equal(detected[0]?.location, null);
  });
});
