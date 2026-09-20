// Stdio E2E for the Kelp MCP server.
//
// Spawns the built binary as a subprocess and drives it through the SDK's
// StdioClientTransport, which is exactly how a real MCP client (Claude
// Code, Claude Desktop, Cursor, etc.) will talk to us. Covers what the
// in-memory test can't: subprocess startup, JSON-RPC framing over pipes,
// and the invariant that nothing else leaks to stdout past the handshake.
//
// Skipped when `dist/index.js` does not exist so a fresh clone that
// hasn't built yet still lets `npm test` pass on the other files.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, "..", "dist", "index.js");

let hasBin = false;
before(async () => {
  try {
    await fs.stat(BIN);
    hasBin = true;
  } catch {
    hasBin = false;
  }
});

test("stdio: spawn kelp mcp, initialize, list tools, call scan_snippet", async (t) => {
  if (!hasBin) {
    t.skip("dist/index.js not built; run `npm run build` first");
    return;
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN, "mcp"],
  });
  const client = new Client({ name: "stdio-e2e", version: "0" });
  await client.connect(transport);
  try {
    const caps = client.getServerCapabilities();
    assert.ok(caps?.tools && caps.resources && caps.prompts, "all three capabilities present");

    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "explain_finding",
      "explain_rule",
      "list_rules",
      "scan_path",
      "scan_snippet",
    ]);

    const res = await client.callTool({
      name: "scan_snippet",
      arguments: {
        path: "server/pay.ts",
        content: 'const k = "sk_live_51H8xQh2eZvKYlo2CabcdEFGH";',
      },
    });
    assert.ok(!res.isError, "scan_snippet call must not error");
    const s = res.structuredContent as { findings: Array<{ ruleId: string }> };
    assert.ok(
      s.findings.some((f) => f.ruleId === "stripe-secret-live"),
      "must fire the Stripe rule over stdio",
    );
  } finally {
    await client.close();
  }
});
