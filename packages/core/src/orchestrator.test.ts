import { test } from "node:test";
import assert from "node:assert/strict";
import { runScan, type ScanDeps, type ScanInput } from "./orchestrator.js";
import type { ConsentStore, AuditLogger } from "./consent.js";
import type { ActiveTestConsent } from "./types.js";

const auditNoop: AuditLogger = { record: async () => {} };
const noConsent: ConsentStore = { getActiveTestConsent: async () => null };
const validConsent: ConsentStore = {
  getActiveTestConsent: async (projectId): Promise<ActiveTestConsent> => ({
    projectId,
    orgId: "o1",
    consented: true,
    consentVersion: "v1",
    consentedBy: "u1",
    consentedAt: new Date(),
    revokedAt: null,
  }),
};

const baseInput: ScanInput = {
  orgId: "o1",
  projectId: "p1",
  repoFullName: "acme/app",
  supabaseRef: "ref1",
  classes: ["secret", "rls", "bola"],
  jobId: "job1",
};

const github = {
  listSourceFiles: async () => [
    { path: "src/lib/client.ts", content: 'const k = "sk_live_51H8xQh2eZvKYlo2CabcdEFGH"' },
  ],
};
const supabase = {
  getSchemaSnapshot: async () => ({
    tables: [
      {
        schema: "public",
        name: "bookings",
        columns: [{ name: "user_id", type: "uuid" }],
        rlsEnabled: false,
        policies: [],
      },
    ],
  }),
};
const bola = {
  probe: async () => [
    { endpoint: "GET /rest/v1/invoices?id=eq.{id}", resourceKind: "invoice", crossAccountAccess: true, parameter: "id" },
  ],
};

test("runs secret + rls and returns findings sorted by severity", async () => {
  const deps: ScanDeps = { github, supabase, consent: noConsent, audit: auditNoop };
  const { findings, errors } = await runScan(
    { ...baseInput, classes: ["secret", "rls"] },
    deps,
  );
  assert.equal(errors.length, 0);
  assert.ok(findings.some((f) => f.vulnClass === "secret"));
  assert.ok(findings.some((f) => f.vulnClass === "rls"));
  assert.equal(findings[0]!.severity, "critical");
});

test("BOLA is blocked without consent and collected as an error", async () => {
  const deps: ScanDeps = { bola, consent: noConsent, audit: auditNoop };
  const { findings, errors } = await runScan({ ...baseInput, classes: ["bola"] }, deps);
  assert.equal(findings.length, 0, "no BOLA findings without consent");
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.vulnClass, "bola");
  assert.match(errors[0]!.message, /consent/i);
});

test("BOLA runs and reports when consent is valid", async () => {
  const deps: ScanDeps = { bola, consent: validConsent, audit: auditNoop };
  const { findings } = await runScan({ ...baseInput, classes: ["bola"] }, deps);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.vulnClass, "bola");
  assert.equal(findings[0]!.fixable, false);
});

test("a class with no connector is simply skipped", async () => {
  const deps: ScanDeps = { consent: noConsent, audit: auditNoop };
  const { findings, errors } = await runScan(baseInput, deps);
  assert.equal(findings.length, 0);
  assert.equal(errors.length, 0);
});

test("one class failing does not abort the others", async () => {
  const brokenSupabase = {
    getSchemaSnapshot: async () => {
      throw new Error("management API 401");
    },
  };
  const deps: ScanDeps = { github, supabase: brokenSupabase, consent: noConsent, audit: auditNoop };
  const { findings, errors } = await runScan(
    { ...baseInput, classes: ["secret", "rls"] },
    deps,
  );
  assert.ok(findings.some((f) => f.vulnClass === "secret"), "secret still ran");
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.vulnClass, "rls");
});
