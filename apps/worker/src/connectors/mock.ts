// Mock connectors + stores for local dev and the demo. They implement the same
// interfaces the real GitHub/Supabase connectors will, so wiring the real ones
// later (once API credentials exist) is a drop-in replacement — nothing in the
// orchestrator changes.

import type {
  GitHubConnector,
  SupabaseConnector,
  BolaConnector,
  ConsentStore,
  AuditLogger,
  SourceFile,
  SchemaSnapshot,
  BolaProbeResult,
  ActiveTestConsent,
} from "@kelp/core";

export const mockGitHub: GitHubConnector = {
  async listSourceFiles(): Promise<SourceFile[]> {
    return [
      {
        path: "src/lib/supabaseClient.ts",
        content:
          'const url = "https://xkltpq.supabase.co"\n' +
          'const serviceKey = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.9dQx7Kf2mLpZa0Rb3Vc6Pd8Ne1Yw4Uh5Tj7Sk2Xm0"\n',
      },
      {
        path: "server/checkout.ts",
        content: 'const stripe = new Stripe("sk_test_abcdEFGH1234ijklMNOPqrst")',
      },
    ];
  },
};

export const mockSupabase: SupabaseConnector = {
  async getSchemaSnapshot(): Promise<SchemaSnapshot> {
    return {
      tables: [
        {
          schema: "public",
          name: "bookings",
          columns: [
            { name: "id", type: "uuid" },
            { name: "user_id", type: "uuid" },
          ],
          rlsEnabled: false,
          policies: [],
        },
        {
          schema: "public",
          name: "profiles",
          columns: [
            { name: "id", type: "uuid" },
            { name: "user_id", type: "uuid" },
          ],
          rlsEnabled: true,
          policies: [
            { name: "open", command: "ALL", usingExpr: "true", withCheckExpr: null, roles: ["anon"] },
          ],
        },
      ],
    };
  },
};

export const mockBola: BolaConnector = {
  async probe(): Promise<BolaProbeResult[]> {
    return [
      {
        endpoint: "GET /rest/v1/invoices?id=eq.{id}",
        resourceKind: "invoice",
        crossAccountAccess: true,
        parameter: "id",
      },
    ];
  },
};

/** Consent store that grants active-test consent for the given project ids. */
export function consentStoreFor(consentedProjectIds: Set<string>): ConsentStore {
  return {
    async getActiveTestConsent(projectId: string): Promise<ActiveTestConsent | null> {
      if (!consentedProjectIds.has(projectId)) return null;
      return {
        projectId,
        orgId: "demo-org",
        consented: true,
        consentVersion: "v1",
        consentedBy: "demo-user",
        consentedAt: new Date(),
        revokedAt: null,
      };
    },
  };
}

/** Audit logger that prints — real one appends to the audit_log table. */
export const consoleAudit: AuditLogger = {
  async record(entry) {
    console.log(`  [audit] ${entry.action} ${entry.resource ?? ""}`.trimEnd());
  },
};
