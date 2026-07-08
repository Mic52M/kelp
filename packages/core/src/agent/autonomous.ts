// Autonomous pen-testing agent — the core of Kelp's "XBOW for vibe-code".
//
// This replaces the scripted list→probe→report specialists with a REAL agent:
// it is handed a target and a rich toolbox, and it reasons, forms hypotheses,
// crafts arbitrary probes, observes, adapts, and loops until it has either
// confirmed a vulnerability or convinced itself the surface is secure. The LLM
// has genuine agency here — it is not walking a fixed script.
//
// The load-bearing guarantee survives, generalized: the model never decides
// on its own that something is a finding. When it wants to report, it must
// hand Kelp a *reproduction* (an exact probe + an expected observable). Kelp
// RE-RUNS that reproduction deterministically and records the finding only if
// the observable actually holds. Autonomy in reasoning, zero fabrication in
// results.
//
// Multi-agent: `createAutonomousPentester(brief)` returns a Specialist scoped
// to one attack surface (data/RLS, edge-function authz/logic, auth/config/…).
// The existing orchestrator dispatches several in parallel — each an
// independent reasoning loop over the same shared toolbox — for broad coverage
// with crash isolation and per-agent cost accounting.

import type { Severity, VulnClass } from "../types.js";
import type { AgentTool, ToolCall, ToolResult } from "./loop.js";
import type { Specialist, SpecialistContext, SpecialistExecutor } from "./specialist.js";

// ─── The toolbox the worker implements ───────────────────────────────────────

/** Which identity a probe is sent as. `anon` = unauthenticated (apikey only). */
export type ProbeIdentity = "anon" | "accountA" | "accountB";

/** Which Supabase surface a probe targets. */
export type ProbeSurface = "postgrest" | "edge" | "auth" | "raw";

export type ProbeMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

export interface ProbeRequest {
  surface: ProbeSurface;
  /** For postgrest: `/rest/v1/<table>?…`. For edge: the function name (or
   *  `/functions/v1/<name>`). For auth: `/auth/v1/<path>`. For raw: a full URL. */
  path: string;
  method?: ProbeMethod;
  identity?: ProbeIdentity;
  body?: unknown;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface ProbeResult {
  status: number;
  /** Response headers, minus the raw values of sensitive ones (Set-Cookie value
   *  is stripped; presence is preserved). */
  headers: Record<string, string>;
  /** A redacted, structure-preserving view of the body: keys, types, row
   *  counts, short scalar values (ids/bools/enums) kept; emails, tokens,
   *  secrets and long free-text replaced with `<email>` / `<redacted:N>`
   *  markers. Never contains raw user PII. */
  bodyPreview: unknown;
  /** Rows returned when the body was a JSON array. */
  rowCount: number | null;
  /** Set when Kelp refused to send the probe (e.g. a destructive edge
   *  function). The agent should treat the endpoint as untested, not safe. */
  blocked?: string;
  elapsedMs: number;
}

export interface TablePolicyIntel {
  name: string;
  command: string;
  roles: string[];
  using: string | null;
  withCheck: string | null;
}
export interface TableIntel {
  name: string;
  columns: { name: string; type: string }[];
  rlsEnabled: boolean;
  policies: TablePolicyIntel[];
}

/** Real capabilities, implemented by the worker (HTTP, pg, repo, listener). */
export interface PentestTools {
  /** Repo file paths (optionally filtered by a simple substring/glob-ish term). */
  listSourceFiles(filter?: string): Promise<string[]>;
  /** Read one repo file (app source — not user data — safe to show the model). */
  readSourceFile(path: string): Promise<{ path: string; content: string; truncated: boolean }>;
  /** Schema + RLS posture from the catalog (never row data). */
  listTables(): Promise<TableIntel[]>;
  /** The weapon: an arbitrary authenticated request. Safety + redaction inside. */
  httpProbe(req: ProbeRequest): Promise<ProbeResult>;
  /** Start an out-of-band canary; returns a URL to feed into a probe. */
  oobCanaryStart(): Promise<{ token: string; url: string }>;
  /** Did the canary fire (target made the outbound request)? */
  oobCanaryCheck(token: string): Promise<{ hit: boolean }>;
  /** Identity uuids so the agent can reason about ownership without guessing. */
  identities(): { accountAUserId: string; accountBUserId: string };
}

// ─── Findings ────────────────────────────────────────────────────────────────

export type ExpectCondition =
  | "status_2xx"
  | "status_401_403" // used to prove an endpoint is (correctly) locked — not a finding, for the agent's own reasoning
  | "status_ge_500"
  | "returns_rows"
  | "row_owned_by_other" // a returned row's owner column != the acting identity
  | "callback_fired"
  | "header_matches"
  | "source_contains";

export interface AutonomousFinding {
  fingerprint: string;
  vulnClass: VulnClass;
  severity: Severity;
  title: string;
  /** human-readable evidence line (redacted; no raw PII) */
  evidence: string;
  /** endpoint / table / function the finding is about */
  endpoint: string;
  surface: ProbeSurface | "config" | "source";
  /** paste-ready prompt for the user's AI coding tool that fixes THIS issue,
   *  written by the agent from the real code it read. */
  fix: string;
}

// ─── Tool schemas ────────────────────────────────────────────────────────────

const PROBE_SCHEMA = {
  type: "object",
  properties: {
    surface: { type: "string", enum: ["postgrest", "edge", "auth", "raw"] },
    path: { type: "string", description: "postgrest: /rest/v1/<table>?filters; edge: function name; auth: /auth/v1/<path>; raw: full URL" },
    method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] },
    identity: { type: "string", enum: ["anon", "accountA", "accountB"], description: "who sends it; anon = no user JWT" },
    body: { type: "object", description: "JSON body (for POST/PUT/PATCH)", additionalProperties: true },
    query: { type: "object", description: "extra query params", additionalProperties: { type: "string" } },
    headers: { type: "object", description: "extra headers", additionalProperties: { type: "string" } },
  },
  required: ["surface", "path"],
  additionalProperties: false,
} as const;

export const AUTONOMOUS_TOOLS: AgentTool[] = [
  {
    name: "list_source_files",
    description:
      "List the connected repo's file paths (optionally filtered by a substring, " +
      "e.g. 'functions' or 'config'). Use this to map the app's real backend " +
      "before attacking it. Source code is the app's own — safe to read fully.",
    inputSchema: { type: "object", properties: { filter: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "read_source_file",
    description:
      "Read one repo file — an edge function's index.ts, supabase/config.toml, a " +
      "shared helper. Read the actual code to find missing auth checks, trust of " +
      "client input, service-role misuse, hardcoded secrets, permissive CORS.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
  },
  {
    name: "list_tables",
    description:
      "List public tables with their columns, whether RLS is enabled, and every " +
      "policy (role, command, USING/WITH CHECK expression). Reason about which " +
      "policies actually enforce ownership vs which are permissive.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "http_probe",
    description:
      "Send one real request as anon / account A / account B against PostgREST, " +
      "an edge function, or Supabase Auth. Returns status, headers, and a " +
      "redacted structure-preserving view of the body (ids/keys/counts kept; PII " +
      "masked). This is how you TEST a hypothesis. Destructive edge functions are " +
      "blocked and reported as such — treat those as untested, not safe.",
    inputSchema: PROBE_SCHEMA,
  },
  {
    name: "oob_canary_start",
    description:
      "Start an out-of-band canary and get a URL. Feed that URL into a probe " +
      "(e.g. an edge function that fetches a user-supplied URL) to test SSRF.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "oob_canary_check",
    description: "Check whether the canary fired — i.e. the target actually made the outbound request.",
    inputSchema: { type: "object", properties: { token: { type: "string" } }, required: ["token"], additionalProperties: false },
  },
  {
    name: "report_finding",
    description:
      "Report a confirmed vulnerability. Kelp RE-RUNS your reproduction and only " +
      "records the finding if the expected observable actually holds — so give a " +
      "precise, self-contained reproduction. Do not report anything you have not " +
      "reproduced with a tool. You MUST also include `fix`: a paste-ready prompt " +
      "that resolves this exact issue, written from the real code you read.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
        vulnClass: { type: "string", enum: ["bola", "auth", "injection", "ssrf", "exposure", "rls", "secret"] },
        surface: { type: "string", enum: ["postgrest", "edge", "auth", "config", "source"] },
        endpoint: { type: "string", description: "table / function / path the finding is about" },
        description: { type: "string", description: "what's wrong and the impact, in plain language; no raw PII" },
        fix: {
          type: "string",
          description:
            "A precise, paste-ready prompt for the user's AI coding tool (Lovable / Bolt / " +
            "Cursor / v0) that fixes THIS exact issue. Name the exact file(s) you read and the " +
            "exact change to make; show the corrected code. If a correct pattern already exists " +
            "elsewhere in the repo, point at it. Written so the user can paste it verbatim and the " +
            "vulnerability is resolved. No placeholders.",
        },
        reproduction: {
          type: "object",
          description: "Either an http probe to re-run, or a source citation.",
          properties: {
            probe: PROBE_SCHEMA,
            sourcePath: { type: "string" },
            sourceContains: { type: "string", description: "exact substring that must exist in the file" },
            canaryToken: { type: "string" },
          },
          additionalProperties: false,
        },
        expect: {
          type: "string",
          enum: [
            "status_2xx", "status_ge_500", "returns_rows", "row_owned_by_other",
            "callback_fired", "header_matches", "source_contains",
          ],
        },
        ownerColumn: { type: "string", description: "for row_owned_by_other: the owner column to check" },
        headerName: { type: "string", description: "for header_matches" },
        headerContains: { type: "string", description: "for header_matches: substring the header value must contain" },
      },
      required: ["title", "severity", "vulnClass", "surface", "endpoint", "description", "fix", "reproduction", "expect"],
      additionalProperties: false,
    },
  },
  {
    name: "conclude",
    description:
      "Call when you have exhausted your hypotheses for your assigned surface — " +
      "either you've reported the confirmed issues, or you're satisfied the " +
      "surface is secure. Summarize what you tested and why you're stopping.",
    inputSchema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false },
  },
];

// ─── The autonomous executor ─────────────────────────────────────────────────

function fingerprint(parts: string[]): string {
  // small, stable, dependency-free hash (djb2) → hex
  let h = 5381;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

class AutonomousExecutor implements SpecialistExecutor<AutonomousFinding> {
  readonly findings: AutonomousFinding[] = [];
  private readonly seen = new Set<string>();
  /** last N probe observations, so report reproductions can reference context */
  private readonly log: string[] = [];

  constructor(
    private readonly tools: PentestTools,
    private readonly defaultVulnClass: VulnClass,
  ) {}

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      switch (call.name) {
        case "list_source_files": {
          const files = await this.tools.listSourceFiles(str(call.input.filter));
          return ok(call, JSON.stringify(files.slice(0, 400)));
        }
        case "read_source_file": {
          const r = await this.tools.readSourceFile(str(call.input.path));
          return ok(call, `path: ${r.path}${r.truncated ? " (truncated)" : ""}\n\n${r.content}`);
        }
        case "list_tables": {
          const t = await this.tools.listTables();
          return ok(call, JSON.stringify(t));
        }
        case "http_probe": {
          const res = await this.tools.httpProbe(toProbe(call.input));
          const summary = `status=${res.status} rows=${res.rowCount ?? "n/a"}${res.blocked ? ` BLOCKED(${res.blocked})` : ""}`;
          this.log.push(summary);
          return ok(call, JSON.stringify(res));
        }
        case "oob_canary_start": {
          const c = await this.tools.oobCanaryStart();
          return ok(call, JSON.stringify(c));
        }
        case "oob_canary_check": {
          const c = await this.tools.oobCanaryCheck(str(call.input.token));
          return ok(call, JSON.stringify(c));
        }
        case "report_finding":
          return await this.handleReport(call);
        case "conclude":
          return ok(call, "acknowledged — run complete");
        default:
          return err(call, `unknown tool ${call.name}`);
      }
    } catch (e) {
      return err(call, `tool error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * The evidence gate. Kelp re-runs the model's reproduction and only records
   * the finding when the expected observable actually holds. This is the
   * general form of the "no confirmed probe → no finding" invariant.
   */
  private async handleReport(call: ToolCall): Promise<ToolResult> {
    const i = call.input as Record<string, unknown>;
    const repro = (i.reproduction ?? {}) as Record<string, unknown>;
    const expect = str(i.expect) as ExpectCondition;
    const endpoint = str(i.endpoint);

    const confirmed = await this.confirm(expect, repro, str(i.ownerColumn), str(i.headerName), str(i.headerContains));
    if (!confirmed.ok) {
      return err(call, `not recorded — Kelp could not reproduce this: ${confirmed.why}. Probe again and only report what you can reproduce.`);
    }

    const fp = fingerprint([str(i.vulnClass), endpoint, str(i.title)]);
    if (!this.seen.has(fp)) {
      this.seen.add(fp);
      this.findings.push({
        fingerprint: fp,
        vulnClass: (validClass(str(i.vulnClass)) ?? this.defaultVulnClass),
        severity: (validSeverity(str(i.severity)) ?? "medium"),
        title: str(i.title) || "Unnamed finding",
        evidence: `${str(i.description)}\n\n[Kelp confirmed: ${confirmed.why}]`,
        endpoint,
        surface: (str(i.surface) as AutonomousFinding["surface"]) || "postgrest",
        fix: str(i.fix),
      });
    }
    return ok(call, "confirmed and recorded for human review");
  }

  /** Deterministically re-verify the claimed observable. */
  private async confirm(
    expect: ExpectCondition,
    repro: Record<string, unknown>,
    ownerColumn: string,
    headerName: string,
    headerContains: string,
  ): Promise<{ ok: boolean; why: string }> {
    // Source-citation evidence (static findings: verify_jwt, CORS-in-code, secrets).
    if (expect === "source_contains") {
      const path = str(repro.sourcePath);
      const needle = str(repro.sourceContains);
      if (!path || !needle) return { ok: false, why: "reproduction.sourcePath + sourceContains required" };
      const file = await this.tools.readSourceFile(path).catch(() => null);
      if (file && file.content.includes(needle)) {
        return { ok: true, why: `${path} contains "${clip(needle, 60)}"` };
      }
      return { ok: false, why: `"${clip(needle, 40)}" not found in ${path}` };
    }

    // Canary evidence (SSRF): the token must have fired.
    if (expect === "callback_fired") {
      const token = str(repro.canaryToken);
      if (!token) return { ok: false, why: "reproduction.canaryToken required" };
      const c = await this.tools.oobCanaryCheck(token).catch(() => ({ hit: false }));
      return c.hit ? { ok: true, why: "out-of-band canary fired" } : { ok: false, why: "canary never fired" };
    }

    // Everything else re-runs an HTTP probe.
    const probeInput = repro.probe as Record<string, unknown> | undefined;
    if (!probeInput) return { ok: false, why: "reproduction.probe required for this expectation" };
    const res = await this.tools.httpProbe(toProbe(probeInput));
    if (res.blocked) return { ok: false, why: `probe was blocked (${res.blocked})` };

    switch (expect) {
      case "status_2xx":
        return res.status >= 200 && res.status < 300
          ? { ok: true, why: `endpoint returned ${res.status}` }
          : { ok: false, why: `expected 2xx, got ${res.status}` };
      case "status_ge_500":
        return res.status >= 500
          ? { ok: true, why: `payload drove the endpoint to ${res.status}` }
          : { ok: false, why: `expected 5xx, got ${res.status}` };
      case "returns_rows":
        return (res.rowCount ?? 0) > 0
          ? { ok: true, why: `returned ${res.rowCount} row(s)` }
          : { ok: false, why: "no rows returned" };
      case "row_owned_by_other": {
        if ((res.rowCount ?? 0) <= 0) return { ok: false, why: "no rows returned" };
        const other = detectForeignOwner(res.bodyPreview, ownerColumn, this.tools.identities());
        return other
          ? { ok: true, why: `read a row whose ${ownerColumn} belongs to another account` }
          : { ok: false, why: `no returned row was owned by another account (check ownerColumn)` };
      }
      case "header_matches": {
        const v = res.headers[headerName.toLowerCase()] ?? "";
        return v.toLowerCase().includes(headerContains.toLowerCase()) && headerContains
          ? { ok: true, why: `header ${headerName}: ${clip(v, 40)}` }
          : { ok: false, why: `header ${headerName} did not contain "${headerContains}"` };
      }
      default:
        return { ok: false, why: `unknown expectation ${expect}` };
    }
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function detectForeignOwner(
  body: unknown,
  ownerColumn: string,
  ids: { accountAUserId: string; accountBUserId: string },
): boolean {
  if (!ownerColumn) return false;
  const rows = Array.isArray(body) ? body : [body];
  for (const r of rows) {
    if (r && typeof r === "object") {
      const v = (r as Record<string, unknown>)[ownerColumn];
      if (typeof v === "string" && v !== ids.accountAUserId && v.length > 0) return true;
    }
  }
  return false;
}

function toProbe(input: Record<string, unknown>): ProbeRequest {
  const p: ProbeRequest = { surface: str(input.surface) as ProbeSurface, path: str(input.path) };
  const method = str(input.method);
  if (method) p.method = method as ProbeMethod;
  const identity = str(input.identity);
  if (identity) p.identity = identity as ProbeIdentity;
  if (input.body !== undefined) p.body = input.body;
  if (input.query && typeof input.query === "object") p.query = input.query as Record<string, string>;
  if (input.headers && typeof input.headers === "object") p.headers = input.headers as Record<string, string>;
  return p;
}

const VULN_CLASSES: VulnClass[] = ["bola", "auth", "injection", "ssrf", "exposure", "rls", "secret"];
const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
function validClass(s: string): VulnClass | null { return (VULN_CLASSES as string[]).includes(s) ? (s as VulnClass) : null; }
function validSeverity(s: string): Severity | null { return (SEVERITIES as string[]).includes(s) ? (s as Severity) : null; }
function str(v: unknown): string { return typeof v === "string" ? v : v == null ? "" : String(v); }
function clip(s: string, n: number): string { return s.length > n ? s.slice(0, n) + "…" : s; }
function ok(call: ToolCall, content: string): ToolResult { return { toolCallId: call.id, content }; }
function err(call: ToolCall, content: string): ToolResult { return { toolCallId: call.id, isError: true, content }; }

// ─── The specialist factory (one per attack-surface brief) ───────────────────

export interface PentestBrief {
  /** stable id, e.g. "agent-data", "agent-edge", "agent-auth" */
  name: string;
  /** default DB class for findings this agent files without their own class */
  vulnClass: VulnClass;
  /** the focused mission appended to the shared pentester persona */
  mission: string;
}

export interface PentesterOptions {
  /** Deterministic backend intelligence to inject into the agent's first
   *  message, so it skips the "grep the repo to find things Kelp already
   *  parsed" phase. Injected as the initial user message context. */
  backendBrief?: string;
}

const PERSONA =
  "You are Kelp — an autonomous penetration tester with explicit, signed " +
  "authorization to attack this single connected project. You test a real " +
  "vibe-coded app on Supabase (Postgres+PostgREST, Edge Functions, Supabase " +
  "Auth). You have two real test accounts (A and B) and can also act " +
  "unauthenticated (anon).\n\n" +
  "Work like a human pentester, not a checklist:\n" +
  "1. RECON — read the schema/policies and the app's source (edge functions, " +
  "config.toml, shared helpers) to understand the real attack surface.\n" +
  "2. HYPOTHESIZE — form specific, testable ideas about where authorization, " +
  "input handling, or business logic could break.\n" +
  "3. ATTACK — send real probes as anon / A / B to test each hypothesis. Try " +
  "cross-account reads, identity override in bodies, missing auth at the " +
  "gateway (verify_jwt=false), injection, SSRF, permissive CORS, exposed " +
  "secrets, broken RLS.\n" +
  "4. OBSERVE & ADAPT — read each result and let it spawn the next hypothesis. " +
  "Keep looping until you've genuinely covered your surface.\n\n" +
  "Rules: Kelp blocks destructive calls (delete/payment/…); treat a blocked " +
  "endpoint as UNTESTED, not safe. Never exfiltrate real user data — you only " +
  "ever see a redacted view. To report, you MUST provide (a) a reproduction Kelp " +
  "can re-run — Kelp confirms the observable before recording, so unproven " +
  "claims are silently dropped — and (b) a precise, paste-ready `fix` prompt " +
  "written from the real code you read, naming the exact file and change so the " +
  "user's AI coding tool resolves it verbatim. When your surface is exhausted, " +
  "call conclude.\n\n" +
  "About the redaction: Kelp masks LONG free-text and known-sensitive keys " +
  "(password/token/…) with `<redacted>` / `<redacted:N>` / `<email>` markers. " +
  "SHORT scalar identifiers — UUIDs, integer ids, enum values, short field " +
  "names — pass through UNCHANGED. If a probe body shows a UUID in a `user_id` " +
  "field that isn't your own uuid, that IS the real value: an actual cross-" +
  "account leak, not a masking artifact. Do not talk yourself out of it.\n\n" +
  "Language discipline: DO NOT write 'VULNERABILITY FOUND' or similar in your " +
  "narration until you have (a) run a probe whose observable proves the claim, " +
  "AND (b) successfully filed report_finding for it (the executor confirms). " +
  "Interpret HTTP status codes carefully: 204 from a PATCH may mean 'no " +
  "content because the update succeeded' OR a PostgREST protocol error — " +
  "always inspect the body/error code before concluding. Suspicion → probe, " +
  "not narration.";

export function createAutonomousPentester(
  brief: PentestBrief,
  opts: PentesterOptions = {},
): Specialist<PentestTools, AutonomousFinding> {
  return {
    name: brief.name,
    vulnClass: brief.vulnClass,
    systemPrompt: `${PERSONA}\n\nYOUR ASSIGNED SURFACE:\n${brief.mission}`,
    tools: AUTONOMOUS_TOOLS,
    initialPrompt(ctx: SpecialistContext): string {
      const brief = opts.backendBrief
        ? `\n\n${opts.backendBrief}\n\nUse the brief above BEFORE grepping the repo. ` +
          `Then hypothesize + probe — every step spent re-discovering things Kelp already ` +
          `told you is one fewer probe you get to run.`
        : "";
      return (
        `Target project ${ctx.projectId}. Begin recon on your assigned surface, ` +
        `then hypothesize and attack. Report every vulnerability you can reproduce. ` +
        `Call conclude when done.${brief}`
      );
    },
    createExecutor(tools: PentestTools): SpecialistExecutor<AutonomousFinding> {
      return new AutonomousExecutor(tools, brief.vulnClass);
    },
  };
}

/** The default multi-agent squad: three autonomous agents, each owning a
 *  surface, all sharing the same toolbox instance in a run. */
export const DEFAULT_PENTEST_SQUAD: PentestBrief[] = [
  {
    name: "agent-data",
    vulnClass: "rls",
    mission:
      "Data access via PostgREST and RLS. Enumerate tables + policies. Hunt " +
      "cross-account reads/writes (BOLA, broken RLS), permissive policies " +
      "(USING(true) for authenticated/anon), tables readable by anon, and " +
      "sensitive columns exposed in responses. Probe as A, B and anon.",
  },
  {
    name: "agent-edge",
    vulnClass: "auth",
    mission:
      "Supabase Edge Functions. Read each function's source + config.toml. Hunt " +
      "missing/incorrect authorization (verify_jwt=false without a manual check, " +
      "trusting a client-supplied user id over the JWT), injection into any " +
      "query/command built from input, SSRF via URL params, and business-logic " +
      "abuse. Never invoke destructive functions — reason about them from source.",
  },
  {
    name: "agent-surface",
    vulnClass: "exposure",
    mission:
      "Configuration & exposure. Permissive CORS, security headers, hardcoded " +
      "secrets in source, user enumeration (e.g. check-email-exists), and open " +
      "Supabase Auth settings. Confirm each with a probe or a source citation.",
  },
];
