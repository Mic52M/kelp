import { test } from "node:test";
import assert from "node:assert/strict";
import type { LlmAgentDriver, LlmStep, ToolResult } from "../loop.js";
import { runCampaignUnsafe, type SpecialistEntry } from "../orchestrator.js";
import type { Specialist } from "../specialist.js";
import { exposureSpecialist, matchSensitive, type ExposureBackend } from "./exposure.js";

class ScriptedDriver implements LlmAgentDriver {
  private i = 0;
  constructor(private readonly steps: LlmStep[]) {}
  async start(): Promise<LlmStep> {
    return this.steps[this.i++] ?? { assistantText: "", toolCalls: [], done: true };
  }
  async provideToolResults(_r: ToolResult[]): Promise<LlmStep> {
    return this.steps[this.i++] ?? { assistantText: "", toolCalls: [], done: true };
  }
}

const ctx = { orgId: "o1", projectId: "p1", jobId: "j1" };

function entry(driver: LlmAgentDriver, backend: ExposureBackend): SpecialistEntry<unknown, unknown> {
  return {
    specialist: exposureSpecialist as unknown as Specialist<unknown, unknown>,
    backend: backend as unknown,
    driver,
  };
}

// ─── matchSensitive: unit-level correctness of the dictionary ─────────────────

test("matchSensitive catches password_hash, salt, resetToken across naming conventions", () => {
  assert.deepEqual(matchSensitive(["id", "email", "password_hash"]), ["password_hash"]);
  assert.deepEqual(matchSensitive(["id", "passwordHash"]), ["passwordHash"]);
  assert.deepEqual(matchSensitive(["id", "PASSWORD_HASH"]), ["PASSWORD_HASH"]);
  assert.deepEqual(matchSensitive(["id", "salt", "PW_HASH"]), ["salt", "PW_HASH"]);
  assert.deepEqual(matchSensitive(["reset_token"]), ["reset_token"]);
});

test("matchSensitive returns empty when the shape is clean", () => {
  assert.deepEqual(matchSensitive(["id", "display_name", "avatar_url"]), []);
  assert.deepEqual(matchSensitive([]), []);
});

// ─── Executor-level tests via the orchestrator ────────────────────────────────

const vulnerableBackend: ExposureBackend = {
  async listEndpoints() {
    return [
      { endpoint: "/api/admin/users-with-hashes" },
      { endpoint: "/api/public-users" },
    ];
  },
  async probeResponseShape(_p, endpoint) {
    if (endpoint.includes("with-hashes")) {
      return { fieldNames: ["id", "email", "password_hash", "salt", "password_reset_token"] };
    }
    return { fieldNames: ["id", "display_name"] };
  },
};

const cleanBackend: ExposureBackend = {
  async listEndpoints() {
    return [{ endpoint: "/api/public-users" }];
  },
  async probeResponseShape() {
    return { fieldNames: ["id", "display_name"] };
  },
};

test("exposure specialist flags the leaky endpoint (sensitive fields recorded on the finding)", async () => {
  const driver = new ScriptedDriver([
    { assistantText: "Listing.", toolCalls: [{ id: "l", name: "list_endpoints", input: {} }], done: false },
    {
      assistantText: "Probing both.",
      toolCalls: [
        { id: "p1", name: "probe_response_shape", input: { endpoint: "/api/admin/users-with-hashes" } },
        { id: "p2", name: "probe_response_shape", input: { endpoint: "/api/public-users" } },
      ],
      done: false,
    },
    {
      assistantText: "Reporting the confirmed one.",
      toolCalls: [{ id: "r", name: "report_finding", input: { endpoint: "/api/admin/users-with-hashes" } }],
      done: false,
    },
    { assistantText: "Done.", toolCalls: [], done: true },
  ]);
  const report = await runCampaignUnsafe(ctx, { entries: [entry(driver, vulnerableBackend)] });
  const outcome = report.outcomes[0]!;
  assert.equal(outcome.findings.length, 1);
  const f = outcome.findings[0] as { endpoint: string; sensitiveFields: string[]; severity: string; status: string };
  assert.match(f.endpoint, /with-hashes/);
  assert.deepEqual(f.sensitiveFields.sort(), ["password_hash", "password_reset_token", "salt"].sort());
  assert.equal(f.severity, "high");
  assert.equal(f.status, "needs_review");
});

test("a clean response shape yields zero findings (no false positive)", async () => {
  const driver = new ScriptedDriver([
    { assistantText: "", toolCalls: [{ id: "l", name: "list_endpoints", input: {} }], done: false },
    {
      assistantText: "",
      toolCalls: [{ id: "p", name: "probe_response_shape", input: { endpoint: "/api/public-users" } }],
      done: false,
    },
    // Model tries to fabricate; executor must refuse.
    {
      assistantText: "",
      toolCalls: [{ id: "r", name: "report_finding", input: { endpoint: "/api/public-users" } }],
      done: false,
    },
    { assistantText: "", toolCalls: [], done: true },
  ]);
  const report = await runCampaignUnsafe(ctx, { entries: [entry(driver, cleanBackend)] });
  assert.equal(report.outcomes[0]!.findings.length, 0);
});

test("report_finding is rejected without a matching probe (invariant)", async () => {
  const driver = new ScriptedDriver([
    {
      assistantText: "",
      toolCalls: [{ id: "r", name: "report_finding", input: { endpoint: "/api/admin/users-with-hashes" } }],
      done: false,
    },
    { assistantText: "", toolCalls: [], done: true },
  ]);
  const report = await runCampaignUnsafe(ctx, { entries: [entry(driver, vulnerableBackend)] });
  assert.equal(report.outcomes[0]!.findings.length, 0);
});

test("the model cannot decide what counts as sensitive — Kelp holds the dictionary", async () => {
  // Backend returns only harmless field names but the model still tries to report.
  // The confirmed map is empty (matchSensitive returned []) so report_finding must fail.
  const driver = new ScriptedDriver([
    {
      assistantText: "",
      toolCalls: [{ id: "p", name: "probe_response_shape", input: { endpoint: "/api/public-users" } }],
      done: false,
    },
    {
      assistantText: "This is definitely sensitive, trust me.",
      toolCalls: [{ id: "r", name: "report_finding", input: { endpoint: "/api/public-users" } }],
      done: false,
    },
    { assistantText: "", toolCalls: [], done: true },
  ]);
  const report = await runCampaignUnsafe(ctx, { entries: [entry(driver, cleanBackend)] });
  assert.equal(report.outcomes[0]!.findings.length, 0);
});
