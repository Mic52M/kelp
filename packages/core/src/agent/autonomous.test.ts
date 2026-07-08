import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAutonomousPentester,
  type PentestTools,
  type ProbeRequest,
  type ProbeResult,
  type TableIntel,
} from "./autonomous.js";
import type { ToolCall } from "./loop.js";

const ctx = { orgId: "o", projectId: "p", jobId: "j" };
const A = "user-A";
const B = "user-B";

/** Mock toolbox whose httpProbe is scripted per-test. */
function mockTools(over: Partial<PentestTools> & { probe?: (r: ProbeRequest) => ProbeResult }): PentestTools {
  return {
    identities: () => ({ accountAUserId: A, accountBUserId: B }),
    listSourceFiles: async () => [],
    readSourceFile: async (path) => ({ path, content: "", truncated: false }),
    listTables: async () => [] as TableIntel[],
    httpProbe: async (r) => over.probe?.(r) ?? { status: 200, headers: {}, bodyPreview: null, rowCount: 0, elapsedMs: 1 },
    oobCanaryStart: async () => ({ token: "t", url: "u" }),
    oobCanaryCheck: async () => ({ hit: false }),
    ...over,
  };
}

function reportCall(input: Record<string, unknown>): ToolCall {
  return { id: "c1", name: "report_finding", input };
}

const exec = (tools: PentestTools) =>
  createAutonomousPentester({ name: "t", vulnClass: "rls", mission: "x" }).createExecutor(tools, ctx);

test("records a finding only when Kelp re-runs the reproduction and the observable holds", async () => {
  const tools = mockTools({
    probe: (r) =>
      r.identity === "accountA" && r.path.includes("orders")
        ? { status: 200, headers: {}, bodyPreview: [{ id: "1", user_id: B }], rowCount: 1, elapsedMs: 1 }
        : { status: 200, headers: {}, bodyPreview: [], rowCount: 0, elapsedMs: 1 },
  });
  const e = exec(tools);
  const res = await e.execute(
    reportCall({
      title: "orders leaks across accounts",
      severity: "high",
      vulnClass: "rls",
      surface: "postgrest",
      endpoint: "orders",
      description: "A reads B's row",
      reproduction: { probe: { surface: "postgrest", path: "/rest/v1/orders", identity: "accountA" } },
      expect: "row_owned_by_other",
      ownerColumn: "user_id",
    }),
  );
  assert.equal(res.isError, undefined);
  assert.equal(e.findings.length, 1);
  assert.equal(e.findings[0]!.vulnClass, "rls");
  assert.match(e.findings[0]!.evidence, /Kelp confirmed/);
});

test("REJECTS a finding whose reproduction does not show the claimed observable", async () => {
  // A well-behaved table: only A's own rows come back → not a leak.
  const tools = mockTools({
    probe: () => ({ status: 200, headers: {}, bodyPreview: [{ id: "1", user_id: A }], rowCount: 1, elapsedMs: 1 }),
  });
  const e = exec(tools);
  const res = await e.execute(
    reportCall({
      title: "bogus leak",
      severity: "high",
      vulnClass: "rls",
      surface: "postgrest",
      endpoint: "profiles",
      description: "claims a leak",
      reproduction: { probe: { surface: "postgrest", path: "/rest/v1/profiles", identity: "accountA" } },
      expect: "row_owned_by_other",
      ownerColumn: "user_id",
    }),
  );
  assert.equal(res.isError, true);
  assert.match(res.content, /could not reproduce/);
  assert.equal(e.findings.length, 0);
});

test("a blocked (destructive) probe can never back a finding", async () => {
  const tools = mockTools({
    probe: () => ({ status: 0, headers: {}, bodyPreview: null, rowCount: null, blocked: "destructive", elapsedMs: 0 }),
  });
  const e = exec(tools);
  const res = await e.execute(
    reportCall({
      title: "delete works",
      severity: "critical",
      vulnClass: "auth",
      surface: "edge",
      endpoint: "delete-account",
      description: "x",
      reproduction: { probe: { surface: "edge", path: "delete-account", identity: "accountA" } },
      expect: "status_2xx",
    }),
  );
  assert.equal(res.isError, true);
  assert.equal(e.findings.length, 0);
});

test("source_contains evidence confirms against the real file", async () => {
  const tools = mockTools({
    readSourceFile: async (path) => ({ path, content: "verify_jwt = false\n", truncated: false }),
  });
  const e = exec(tools);
  const res = await e.execute(
    reportCall({
      title: "add-user-role exposed at gateway",
      severity: "medium",
      vulnClass: "auth",
      surface: "config",
      endpoint: "add-user-role",
      description: "verify_jwt disabled",
      reproduction: { sourcePath: "supabase/config.toml", sourceContains: "verify_jwt = false" },
      expect: "source_contains",
    }),
  );
  assert.equal(res.isError, undefined);
  assert.equal(e.findings.length, 1);
});

test("header_matches confirms permissive CORS from a live response", async () => {
  const tools = mockTools({
    probe: () => ({ status: 200, headers: { "access-control-allow-origin": "*" }, bodyPreview: {}, rowCount: null, elapsedMs: 1 }),
  });
  const e = exec(tools);
  const res = await e.execute(
    reportCall({
      title: "wildcard CORS",
      severity: "low",
      vulnClass: "exposure",
      surface: "edge",
      endpoint: "ai-coach",
      description: "ACAO *",
      reproduction: { probe: { surface: "edge", path: "ai-coach", method: "HEAD" } },
      expect: "header_matches",
      headerName: "access-control-allow-origin",
      headerContains: "*",
    }),
  );
  assert.equal(res.isError, undefined);
  assert.equal(e.findings.length, 1);
});

test("deduplicates identical findings by class+endpoint+title", async () => {
  const tools = mockTools({
    probe: () => ({ status: 200, headers: {}, bodyPreview: [{ id: "1", user_id: B }], rowCount: 1, elapsedMs: 1 }),
  });
  const e = exec(tools);
  const call = reportCall({
    title: "orders leak", severity: "high", vulnClass: "rls", surface: "postgrest",
    endpoint: "orders", description: "x",
    reproduction: { probe: { surface: "postgrest", path: "/rest/v1/orders", identity: "accountA" } },
    expect: "row_owned_by_other", ownerColumn: "user_id",
  });
  await e.execute(call);
  await e.execute(call);
  assert.equal(e.findings.length, 1);
});
