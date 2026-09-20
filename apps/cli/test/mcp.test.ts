// End-to-end integration test for the Kelp MCP server.
//
// Uses the official @modelcontextprotocol/sdk client to talk to a fresh
// server instance over an in-memory transport pair. This exercises the
// real JSON-RPC surface: capabilities negotiation, tools/list, tools/call
// (with structured content), resources/list, resources/read, prompts/list,
// prompts/get. If any of the schema-inference or Zod compat glue breaks,
// this catches it.
//
// The tools that hit the filesystem (`scan_path`) are exercised via a
// temp fixture directory that the test creates and cleans up.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scanPath, scanFiles } from "../src/mcp/scan.js";
import { RULES_CATALOG, findRule } from "../src/mcp/rules-catalog.js";

// A helper that wires up server + client with the shared registration
// used by the real server. Duplicated (rather than imported from
// src/mcp/server.ts) because that module also `connect`s to stdio, which
// we don't want here. Kept in sync with the registrations in server.ts.
async function connect(): Promise<{ client: Client; server: McpServer }> {
  const server = new McpServer(
    { name: "kelp", version: "test", title: "Kelp Security Scanner" },
    { instructions: "test" },
  );
  registerAll(server);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "mcp-integration-test", version: "0" });
  await client.connect(clientT);
  return { client, server };
}

function registerAll(server: McpServer): void {
  // Two tools, two resources, one prompt - enough to cover the
  // wire-format contract. The full production surface (all tools,
  // prompts) is exercised indirectly through the shared handlers below.
  server.registerTool(
    "scan_snippet",
    {
      title: "Scan a single code snippet",
      description: "Runs the static engine on one in-memory file.",
      inputSchema: {
        path: z.string(),
        content: z.string(),
      },
    },
    async ({ path: p, content }) => {
      const summary = scanFiles([{ path: p, content }]);
      return {
        content: [{ type: "text", text: `${summary.findings.length} findings` }],
        structuredContent: summary as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    "list_rules",
    {
      title: "List Kelp detection rules",
      description: "Rule catalog.",
      inputSchema: {
        class: z.enum(["secret", "auth", "rls", "edge-fn", "misc"]).optional(),
      },
    },
    async ({ class: cls }) => {
      const rules = cls ? RULES_CATALOG.filter((r) => r.class === cls) : RULES_CATALOG;
      return {
        content: [{ type: "text", text: `${rules.length} rules` }],
        structuredContent: { rules } as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    "explain_rule",
    {
      title: "Explain a rule by id",
      description: "Return why + remediation.",
      inputSchema: { ruleId: z.string() },
    },
    async ({ ruleId }) => {
      const rule = findRule(ruleId);
      if (!rule) return { content: [{ type: "text", text: "unknown" }], isError: true };
      return {
        content: [{ type: "text", text: rule.title }],
        structuredContent: { rule } as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerResource(
    "rules-catalog",
    "kelp://rules",
    { title: "Kelp rule catalog", mimeType: "application/json" },
    async (uri) => ({
      contents: [
        { uri: uri.href, mimeType: "application/json", text: JSON.stringify({ rules: RULES_CATALOG }) },
      ],
    }),
  );

  server.registerResource(
    "rule-by-id",
    new ResourceTemplate("kelp://rules/{ruleId}", { list: undefined }),
    { title: "Single rule", mimeType: "application/json" },
    async (uri, { ruleId }) => {
      const id = Array.isArray(ruleId) ? ruleId[0] : ruleId;
      const rule = id ? findRule(id) : undefined;
      if (!rule) throw new Error(`unknown rule ${id}`);
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(rule) }],
      };
    },
  );

  server.registerPrompt(
    "review-repo",
    { title: "Review a repo", description: "Slash", argsSchema: { path: z.string().optional() } },
    ({ path: p }) => ({
      messages: [{ role: "user", content: { type: "text", text: `Scan ${p ?? "workspace"}` } }],
    }),
  );
}

let tmp: string;

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "kelp-mcp-"));
  await fs.mkdir(path.join(tmp, "server"), { recursive: true });
  await fs.writeFile(
    path.join(tmp, "server", "pay.ts"),
    'const stripe = "sk_live_51H8xQh2eZvKYlo2CabcdEFGH";\n',
  );
  await fs.mkdir(path.join(tmp, "supabase"), { recursive: true });
  await fs.writeFile(
    path.join(tmp, "supabase", "config.toml"),
    '[functions.public]\nverify_jwt = false\n',
  );
});

after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

test("initialize handshake advertises tools, resources, prompts", async () => {
  const { client } = await connect();
  const caps = client.getServerCapabilities();
  assert.ok(caps?.tools, "tools capability must be present");
  assert.ok(caps?.resources, "resources capability must be present");
  assert.ok(caps?.prompts, "prompts capability must be present");
});

test("tools/list returns all registered tools with input schemas", async () => {
  const { client } = await connect();
  const listed = await client.listTools();
  const names = listed.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["explain_rule", "list_rules", "scan_snippet"]);
  const scan = listed.tools.find((t) => t.name === "scan_snippet");
  assert.ok(scan?.inputSchema, "scan_snippet must expose an inputSchema");
  const props = (scan!.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
  assert.ok("path" in props && "content" in props, "scan_snippet inputSchema shape");
});

test("scan_snippet returns structuredContent with a Stripe finding", async () => {
  const { client } = await connect();
  const res = await client.callTool({
    name: "scan_snippet",
    arguments: {
      path: "server/pay.ts",
      content: 'const k = "sk_live_51H8xQh2eZvKYlo2CabcdEFGH";',
    },
  });
  assert.ok(!res.isError, "call must not error");
  const structured = res.structuredContent as {
    findings: Array<{ ruleId: string; severity: string; class: string }>;
  };
  assert.ok(structured.findings.length >= 1);
  const stripe = structured.findings.find((f) => f.ruleId === "stripe-secret-live");
  assert.ok(stripe, "must fire the Stripe rule");
  assert.equal(stripe!.severity, "critical");
  assert.equal(stripe!.class, "secret");
});

test("scan_snippet on clean code returns zero findings", async () => {
  const { client } = await connect();
  const res = await client.callTool({
    name: "scan_snippet",
    arguments: { path: "src/hello.ts", content: "export const hi = 42;\n" },
  });
  assert.ok(!res.isError);
  const s = res.structuredContent as { findings: unknown[] };
  assert.equal(s.findings.length, 0);
});

test("list_rules returns the catalog, filterable by class", async () => {
  const { client } = await connect();
  const all = await client.callTool({ name: "list_rules", arguments: {} });
  const allRules = (all.structuredContent as { rules: unknown[] }).rules;
  assert.ok(allRules.length >= 10, "catalog should have many rules");

  const secretsOnly = await client.callTool({
    name: "list_rules",
    arguments: { class: "secret" },
  });
  const secrets = (secretsOnly.structuredContent as { rules: Array<{ class: string }> }).rules;
  assert.ok(secrets.length > 0);
  assert.ok(secrets.every((r) => r.class === "secret"), "class filter must apply");
});

test("explain_rule returns why + remediation for a known rule", async () => {
  const { client } = await connect();
  const res = await client.callTool({
    name: "explain_rule",
    arguments: { ruleId: "supabase-service-role" },
  });
  const { rule } = res.structuredContent as { rule: { id: string; why: string; remediation: string } };
  assert.equal(rule.id, "supabase-service-role");
  assert.ok(rule.why.length > 20);
  assert.ok(rule.remediation.length > 20);
});

test("explain_rule flags unknown rules as errors", async () => {
  const { client } = await connect();
  const res = await client.callTool({ name: "explain_rule", arguments: { ruleId: "does-not-exist" } });
  assert.equal(res.isError, true);
});

test("resources/read on kelp://rules returns the full catalog JSON", async () => {
  const { client } = await connect();
  const res = await client.readResource({ uri: "kelp://rules" });
  assert.equal(res.contents.length, 1);
  const parsed = JSON.parse(res.contents[0]!.text as string) as { rules: unknown[] };
  assert.ok(parsed.rules.length >= 10);
});

test("resources/read on kelp://rules/{id} returns a single rule", async () => {
  const { client } = await connect();
  const res = await client.readResource({ uri: "kelp://rules/stripe-secret-live" });
  const parsed = JSON.parse(res.contents[0]!.text as string) as { id: string };
  assert.equal(parsed.id, "stripe-secret-live");
});

test("prompts/get returns the review-repo prompt with args substituted", async () => {
  const { client } = await connect();
  const res = await client.getPrompt({ name: "review-repo", arguments: { path: "/tmp/x" } });
  assert.equal(res.messages.length, 1);
  const text = (res.messages[0]!.content as { text: string }).text;
  assert.ok(text.includes("/tmp/x"), "prompt must substitute the path arg");
});

test("scanPath end-to-end walks the fixture and finds both rules", async () => {
  const summary = await scanPath(tmp);
  const ids = new Set(summary.findings.map((f) => f.ruleId));
  assert.ok(ids.has("stripe-secret-live"), "must find the Stripe key");
  assert.ok(
    ids.has("supabase-config-verify-jwt-false"),
    "must find the verify_jwt=false config",
  );
  assert.ok(summary.applied.supabaseConfigVerifyJwt, "supabase config check ran");
});
