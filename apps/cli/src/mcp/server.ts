// MCP server for Kelp. Exposes the static scanning surface as tools,
// resources, and slash-command prompts so an MCP client (Claude Code,
// Claude Desktop, Cursor, etc.) can call Kelp mid-conversation while
// generating code.
//
// Design choices worth calling out:
//
// 1. Tools return BOTH `content` (short text for the model) and
//    `structuredContent` (typed JSON for programmatic use). The model reads
//    the text; a downstream tool consumer parses the JSON.
// 2. Only the STATIC engine is exposed. The `--agent` path is paid and has
//    non-trivial cost expectations; wrapping it in an MCP tool without a
//    hard budget would be a footgun. Reserved for a v2.
// 3. Resources are read-only. `kelp://rules` lists the catalog, and
//    `kelp://rules/{id}` returns a per-rule spec. Enables MCP clients to
//    surface rule metadata without a scan.
// 4. Prompts are the killer feature: they show up as slash commands in the
//    client. `/kelp:review-repo` and `/kelp:harden-file` turn Kelp into a
//    first-class action inside the editor's LLM.
// 5. Everything is stdio-only for now. Streamable-HTTP transport can land
//    later if there is a real deployment use case; the local case is 100%
//    of what MCP is for today.

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { scanPath, scanFiles } from "./scan.js";
import { RULES_CATALOG, findRule } from "./rules-catalog.js";
import type { SourceFile } from "@kelp/core";

const SERVER_INSTRUCTIONS = `\
Kelp is a static security scanner for AI-generated (vibe-coded) apps that
target Supabase, Next.js, and similar stacks.

Use \`scan_path\` when the user asks you to audit a repo or when you are
about to hand the user a change and want to double-check it. Use
\`scan_snippet\` when you have just written a block of code and want to
check it before committing.

All scans run locally and offline. No file content ever leaves the machine
running this MCP server.

When a finding fires, call \`explain_finding\` (or \`explain_rule\`) to get
the reasoning and remediation you can offer the user.

Severities go critical > high > medium > low. Treat critical as
blocking: refuse to hand the user code that would trip a critical finding
without first offering a fix.\
`;

export async function startMcpServer(version: string): Promise<void> {
  const server = new McpServer(
    { name: "kelp", version, title: "Kelp Security Scanner" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerTools(server);
  registerResources(server);
  registerPrompts(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // From here the server owns stdio until the client disconnects. Do NOT
  // write anything to stdout past this point: it corrupts JSON-RPC.
}

// ── Tools ───────────────────────────────────────────────────────────────

function registerTools(server: McpServer): void {
  // scan_path: full repo scan.
  server.registerTool(
    "scan_path",
    {
      title: "Scan a repository or directory",
      description:
        "Runs Kelp's static engine over a filesystem path. Detects hardcoded secrets (Stripe, AWS, GitHub, OpenAI, Anthropic, Supabase service_role, private keys, and more), Supabase edge functions that skip JWT verification, and recons Supabase edge-fn deployables. Fast, offline, deterministic. Returns findings sorted by severity.",
      inputSchema: {
        path: z
          .string()
          .describe(
            "Absolute or relative filesystem path to scan. Should be the repo root or a subdirectory of it.",
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ path: p }) => {
      const summary = await scanPath(p);
      return {
        content: [{ type: "text", text: summarizeForModel(summary) }],
        structuredContent: summary as unknown as Record<string, unknown>,
      };
    },
  );

  // scan_snippet: single in-memory buffer.
  server.registerTool(
    "scan_snippet",
    {
      title: "Scan a single code snippet",
      description:
        "Runs the static engine on one in-memory string as if it were a file. Use this after generating code, before showing it to the user or committing it. Cheaper than scan_path when only a diff is at stake.",
      inputSchema: {
        path: z
          .string()
          .describe(
            "The path this snippet would live at, e.g. src/api/orders.ts. Used to make client-side heuristics work (files under public/, src/components/, *.tsx, etc. are treated as shipped to the browser).",
          ),
        content: z
          .string()
          .describe("The full source text of the file/snippet."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ path: p, content }) => {
      const files: SourceFile[] = [{ path: p, content }];
      const summary = scanFiles(files);
      return {
        content: [{ type: "text", text: summarizeForModel(summary) }],
        structuredContent: summary as unknown as Record<string, unknown>,
      };
    },
  );

  // list_rules: introspection.
  server.registerTool(
    "list_rules",
    {
      title: "List Kelp detection rules",
      description:
        "Returns the catalog of rules Kelp can fire on. Use this to introspect coverage before scanning, or to answer 'does Kelp check X?' without running a scan.",
      inputSchema: {
        class: z
          .enum(["secret", "auth", "rls", "edge-fn", "misc"])
          .optional()
          .describe("Optional filter to a single rule class."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ class: cls }) => {
      const rules = cls ? RULES_CATALOG.filter((r) => r.class === cls) : RULES_CATALOG;
      const summary = rules
        .map((r) => `- ${r.id} (${r.severity}, ${r.class}): ${r.title}`)
        .join("\n");
      return {
        content: [
          {
            type: "text",
            text: `${rules.length} rule${rules.length === 1 ? "" : "s"}${cls ? ` in class '${cls}'` : ""}:\n${summary}`,
          },
        ],
        structuredContent: { rules } as unknown as Record<string, unknown>,
      };
    },
  );

  // explain_finding: take a fired finding, get the remediation to act on.
  server.registerTool(
    "explain_finding",
    {
      title: "Explain a specific finding and how to fix it",
      description:
        "Given a ruleId (and optionally the finding's path + preview), returns the reasoning ('why this matters') and a concrete remediation you can turn into a code change or an instruction to the user.",
      inputSchema: {
        ruleId: z.string().describe("The rule id from a scan finding, e.g. 'stripe-secret-live'."),
        path: z
          .string()
          .optional()
          .describe("The file path where the finding fired. Optional, used for context in the response."),
        preview: z
          .string()
          .optional()
          .describe("The masked preview from the finding. Optional, used verbatim in the response."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ ruleId, path: p, preview }) => {
      const rule = findRule(ruleId);
      if (!rule) {
        return {
          content: [{ type: "text", text: `Unknown ruleId: ${ruleId}. Call list_rules to see valid ids.` }],
          isError: true,
        };
      }
      const location = p ? `\n\nLocation: \`${p}\`` : "";
      const previewLine = preview ? `\nPreview: \`${preview}\`` : "";
      const text = [
        `**${rule.title}** (${rule.severity}, ${rule.class})`,
        location + previewLine,
        `\n**Why this matters.** ${rule.why}`,
        `\n**Remediation.** ${rule.remediation}`,
      ]
        .join("")
        .trim();
      return {
        content: [{ type: "text", text }],
        structuredContent: {
          rule,
          path: p ?? null,
          preview: preview ?? null,
        } as unknown as Record<string, unknown>,
      };
    },
  );

  // explain_rule: identical shape, without a specific finding. Handy for
  // 'what does rule X check?' queries.
  server.registerTool(
    "explain_rule",
    {
      title: "Explain a rule by id",
      description:
        "Given a ruleId, returns the rule's title, class, severity, why-it-matters, and remediation pattern. Use before or after a scan to understand a rule without an active finding.",
      inputSchema: {
        ruleId: z.string().describe("The rule id, e.g. 'supabase-service-role'."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ ruleId }) => {
      const rule = findRule(ruleId);
      if (!rule) {
        return {
          content: [{ type: "text", text: `Unknown ruleId: ${ruleId}.` }],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `**${rule.title}** (${rule.severity}, ${rule.class})\n\n**Why.** ${rule.why}\n\n**Remediation.** ${rule.remediation}`,
          },
        ],
        structuredContent: { rule } as unknown as Record<string, unknown>,
      };
    },
  );
}

// ── Resources ──────────────────────────────────────────────────────────

function registerResources(server: McpServer): void {
  // Fixed URI: the full catalog.
  server.registerResource(
    "rules-catalog",
    "kelp://rules",
    {
      title: "Kelp rule catalog",
      description: "Every detection rule Kelp knows about, as JSON.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ rules: RULES_CATALOG }, null, 2),
        },
      ],
    }),
  );

  // Templated URI: one rule by id.
  server.registerResource(
    "rule-by-id",
    new ResourceTemplate("kelp://rules/{ruleId}", {
      list: async () => ({
        resources: RULES_CATALOG.map((r) => ({
          uri: `kelp://rules/${r.id}`,
          name: r.id,
          title: r.title,
          description: r.why,
          mimeType: "application/json",
        })),
      }),
    }),
    {
      title: "Single Kelp rule by id",
      description: "Full specification (title, class, severity, why, remediation) for one rule.",
      mimeType: "application/json",
    },
    async (uri, { ruleId }) => {
      const id = Array.isArray(ruleId) ? ruleId[0] : ruleId;
      const rule = id ? findRule(id) : undefined;
      if (!rule) {
        throw new Error(`Unknown rule: ${id}`);
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(rule, null, 2),
          },
        ],
      };
    },
  );
}

// ── Prompts (slash commands in MCP-aware clients) ──────────────────────

function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "review-repo",
    {
      title: "Review a repo with Kelp",
      description:
        "Ask the assistant to run Kelp over a project and summarize the critical and high findings with concrete remediation.",
      argsSchema: {
        path: z
          .string()
          .optional()
          .describe("Directory to scan. Defaults to the current workspace root."),
      },
    },
    ({ path: p }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Run Kelp over ${p ? `\`${p}\`` : "the current workspace"} and give me:`,
              "",
              "1. A short header with total finding counts by severity.",
              "2. Every critical or high finding, one per section, with file:line, why it matters, and a one-paragraph fix I can act on.",
              "3. If there are medium findings, list them in a compact table at the end.",
              "4. If there are zero findings, say so explicitly and mention what was scanned so I know the scanner ran.",
              "",
              "Use the `scan_path` tool for the scan, then `explain_finding` for each critical/high result. Do not paraphrase the remediation; use the exact text `explain_finding` returns.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "harden-file",
    {
      title: "Harden a single file with Kelp",
      description:
        "Ask the assistant to scan one file, then rewrite it in place to remove any critical or high finding.",
      argsSchema: {
        path: z.string().describe("Path to the file to harden."),
      },
    },
    ({ path: p }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Harden \`${p}\` using Kelp.`,
              "",
              "1. Read the file.",
              "2. Call `scan_snippet` with the file's path and content.",
              "3. For every critical or high finding, call `explain_finding` and produce a fix.",
              "4. Show me a diff of the edits before applying them. Do not apply without confirmation if any change alters application behavior beyond secret removal.",
              "5. If nothing critical or high fires, say so and stop.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function summarizeForModel(summary: {
  findings: { severity: string; ruleId: string; path: string; line: number; title: string }[];
  filesScanned: number;
  durationMs: number;
}): string {
  const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of summary.findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  const header = `Scanned ${summary.filesScanned} file${summary.filesScanned === 1 ? "" : "s"} in ${(summary.durationMs / 1000).toFixed(2)}s. ${
    summary.findings.length
  } finding${summary.findings.length === 1 ? "" : "s"}: ${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low.`;
  if (summary.findings.length === 0) return `${header}\n\nNothing to report.`;
  const preview = summary.findings
    .slice(0, 10)
    .map(
      (f) =>
        `- [${f.severity.toUpperCase()}] ${f.ruleId} at ${f.path}:${f.line} - ${f.title}`,
    )
    .join("\n");
  const more =
    summary.findings.length > 10
      ? `\n(+${summary.findings.length - 10} more, in structuredContent)`
      : "";
  return `${header}\n\n${preview}${more}`;
}
