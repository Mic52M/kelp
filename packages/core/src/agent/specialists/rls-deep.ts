// RLS-deep specialist (probe-based).
//
// Complements Kelp's *static* RLS analyzer (which reads pg_policies and flags
// "no policy" or "USING(true)") with an *active* one that actually
// authenticates as two test accounts and tries to read rows across them. This
// catches the subtler policy bugs the static analyzer misses — policies that
// reference the wrong column, policies that only apply to the wrong role,
// policies that resolve to true because of a JOIN nobody thought about.
//
// Same load-bearing invariant every Kelp specialist enforces:
// `report_finding` is refused unless a matching `probe_cross_account_read`
// on the same table returned crossAccountAccess = true.

import { fingerprint } from "../../fingerprint.js";
import type { Severity } from "../../types.js";
import type { AgentTool, ToolCall, ToolResult } from "../loop.js";
import type { Specialist, SpecialistContext, SpecialistExecutor } from "../specialist.js";

/** Deterministic backend the RLS-deep tools call into. */
export interface RlsDeepBackend {
  /** Tables reachable on the project. The specialist never sees the RLS flag
   *  a priori — that's what it's probing for. */
  listTables(projectId: string): Promise<{ table: string; description?: string }[]>;
  /** From account A's session, attempt to read a row owned by test account B
   *  from `table`. Returns only whether that read succeeded — never the
   *  third-party rows. */
  probeCrossAccountRead(
    projectId: string,
    table: string,
  ): Promise<{ crossAccountAccess: boolean }>;
}

/** A confirmed RLS-deep finding. */
export interface RlsDeepReport {
  fingerprint: string;
  severity: Severity;
  title: string;
  table: string;
  evidence: string;
  status: "needs_review";
}

const RLS_DEEP_TOOLS: AgentTool[] = [
  {
    name: "list_tables",
    description:
      "List the tables reachable on this project. Kelp does NOT tell you " +
      "up-front which tables have RLS enabled — that's what you're probing. " +
      "Call this first.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "probe_cross_account_read",
    description:
      "From Kelp's test account A, attempt to read rows owned by test " +
      "account B on the given table. Returns whether the cross-account read " +
      "succeeded. Never returns the other account's rows themselves.",
    inputSchema: {
      type: "object",
      properties: { table: { type: "string" } },
      required: ["table"],
      additionalProperties: false,
    },
  },
  {
    name: "report_finding",
    description:
      "Record a confirmed RLS-deep finding. ONLY allowed after a matching " +
      "probe_cross_account_read on the same table returned crossAccountAccess=true.",
    inputSchema: {
      type: "object",
      properties: { table: { type: "string" } },
      required: ["table"],
      additionalProperties: false,
    },
  },
];

const RLS_DEEP_SYSTEM =
  "You are Kelp's authorized security tester, checking a single connected " +
  "project for row-level-security bypasses. You have explicit consent to " +
  "test this project. Plan efficiently: first list the tables, then probe " +
  "each one from account A trying to reach account B's rows. The static " +
  "analyzer already caught the tables with no policy at all — you are " +
  "hunting the subtler cases where a policy exists but doesn't actually " +
  "enforce ownership. Only report tables where a probe confirmed the " +
  "cross-account read. Never attempt to exfiltrate real user rows. Stop " +
  "once you've probed the surface and reported confirmed leaks.";

/**
 * RLS-deep executor. Same "no confirmed probe → no finding" invariant every
 * other Kelp specialist enforces.
 */
class RlsDeepExecutor implements SpecialistExecutor<RlsDeepReport> {
  readonly findings: RlsDeepReport[] = [];
  private readonly confirmed = new Set<string>();
  private readonly reported = new Set<string>();

  constructor(
    private readonly backend: RlsDeepBackend,
    private readonly projectId: string,
  ) {}

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      if (call.name === "list_tables") {
        const ts = await this.backend.listTables(this.projectId);
        return { toolCallId: call.id, content: JSON.stringify(ts) };
      }

      if (call.name === "probe_cross_account_read") {
        const table = String(call.input.table ?? "");
        const { crossAccountAccess } = await this.backend.probeCrossAccountRead(this.projectId, table);
        if (crossAccountAccess) this.confirmed.add(table);
        return {
          toolCallId: call.id,
          content: crossAccountAccess
            ? `cross-account read SUCCEEDED — account A reached account B's rows in ${table}`
            : `denied — RLS blocked the cross-account read on ${table}`,
        };
      }

      if (call.name === "report_finding") {
        const table = String(call.input.table ?? "");
        if (!this.confirmed.has(table)) {
          return {
            toolCallId: call.id,
            isError: true,
            content: "rejected — no successful probe confirms this table; probe it first",
          };
        }
        if (!this.reported.has(table)) {
          this.reported.add(table);
          this.findings.push({
            fingerprint: fingerprint(["rls-deep", table]),
            severity: "high",
            title: `Row-level security bypassed on table "${table}"`,
            table,
            evidence:
              `A probe from Kelp's authorized test — reading table "${table}" ` +
              `from account A while asking for a row owned by account B — succeeded. ` +
              `The policy on this table (if any) does not actually enforce ownership.`,
            status: "needs_review",
          });
        }
        return { toolCallId: call.id, content: "finding recorded for human review" };
      }

      return { toolCallId: call.id, isError: true, content: `unknown tool ${call.name}` };
    } catch (e) {
      return {
        toolCallId: call.id,
        isError: true,
        content: `tool error: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
}

/** The RLS-deep specialist — plug into the orchestrator alongside the others. */
export const rlsDeepSpecialist: Specialist<RlsDeepBackend, RlsDeepReport> = {
  name: "rls-deep",
  vulnClass: "rls", // deliberately reuses the existing class — same fix path
  systemPrompt: RLS_DEEP_SYSTEM,
  tools: RLS_DEEP_TOOLS,
  initialPrompt(ctx: SpecialistContext): string {
    return `Probe project ${ctx.projectId} for row-level-security bypasses.`;
  },
  createExecutor(backend: RlsDeepBackend, ctx: SpecialistContext): SpecialistExecutor<RlsDeepReport> {
    return new RlsDeepExecutor(backend, ctx.projectId);
  },
};
