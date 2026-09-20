# Kelp MCP server

Kelp ships an MCP server so an LLM can call it mid-conversation. Instead of scanning after the fact, the model asks Kelp for a check while generating code, sees the findings, and rewrites accordingly. Same static engine as `kelp scan`, exposed as tools, resources, and slash commands over the Model Context Protocol.

Runs locally, offline, over stdio. No file content ever leaves the machine running the server.

## Install

The server ships in the standard CLI. If you already have the CLI:

```bash
npm i -g @kelp-security/cli
```

Then wire it into your MCP client. Config below.

### Claude Code

Add to `~/.claude.json` (or the file your version uses):

```json
{
  "mcpServers": {
    "kelp": {
      "command": "npx",
      "args": ["-y", "@kelp-security/cli", "mcp"]
    }
  }
}
```

### Claude Desktop

Same shape, in `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on your OS:

```json
{
  "mcpServers": {
    "kelp": {
      "command": "npx",
      "args": ["-y", "@kelp-security/cli", "mcp"]
    }
  }
}
```

Restart Claude Desktop. You should see `kelp` in the connected servers list.

### Cursor

Add to Cursor's MCP config (settings, MCP section):

```json
{
  "kelp": {
    "command": "npx",
    "args": ["-y", "@kelp-security/cli", "mcp"]
  }
}
```

### Any other MCP-compatible client

The server speaks stdio JSON-RPC per MCP 2025-06-18. Any conforming client works. The command to spawn is `kelp mcp` (or `npx @kelp-security/cli mcp`).

## What the model gets

### Tools

| name | when to call it |
| --- | --- |
| `scan_path` | Full static scan over a filesystem path. Use when the user asks to audit a repo or when you want to double-check a working tree before handing back changes. |
| `scan_snippet` | Static scan over one in-memory buffer. Use after generating a diff, before committing. Cheaper and faster than `scan_path`. |
| `list_rules` | Introspect the rule catalog. Optional `class` filter (`secret`, `edge-fn`, ...). Answers "does Kelp check X?" without a scan. |
| `explain_finding` | Given a `ruleId` (and optionally the finding's `path`/`preview`), return why it matters and a remediation. |
| `explain_rule` | Given a `ruleId`, return the rule spec. Same fields as `explain_finding` without a specific finding context. |

Every tool call returns two payloads:

- `content[0].text`: a short summary the model reads.
- `structuredContent`: the same information as typed JSON for programmatic consumers.

### Resources

| uri | shape |
| --- | --- |
| `kelp://rules` | Full rule catalog as JSON. |
| `kelp://rules/{ruleId}` | Single rule spec by id. |

Useful for MCP-aware UIs that want to render rule metadata without triggering a scan. Also lets the model reference a rule stably across turns without re-fetching.

### Prompts (slash commands)

MCP-aware clients surface these as slash commands. Both take an optional file/repo argument.

- `/kelp:review-repo` — scan the workspace and summarize critical + high findings with fixes.
- `/kelp:harden-file` — scan a specific file, then rewrite it to remove any critical or high finding.

## What is NOT exposed (yet)

The paid `--agent` scan (LLM-driven deep inspection) is deliberately not an MCP tool in v1. Wrapping a paid, agentic path in an MCP tool without a hard budget is a footgun, so it stays behind the explicit CLI flag until the pattern for cost-capped agent tools is settled.

## Verify it works

From the CLI, without a client:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' | kelp mcp
```

You should see a JSON-RPC response with `serverInfo.name = "kelp"` and three capabilities (`tools`, `resources`, `prompts`).

From inside a client, ask the LLM: "Use Kelp to scan this repo." A well-connected client will call `scan_path` on its own.

## Design notes

- The whole subprocess is dedicated to JSON-RPC once `kelp mcp` starts. No CLI code path writes to stdout past the handshake or the transport corrupts.
- The static engine is reused verbatim from `@kelp/core`. If a rule fires in `kelp scan`, it fires in the MCP scan. Nothing is duplicated.
- Rule catalog with rich per-rule metadata lives in `apps/cli/src/mcp/rules-catalog.ts`, wired to `explain_finding` and `explain_rule`.

See `apps/cli/src/mcp/` for the source and `apps/cli/test/mcp*.test.ts` for the integration tests (both in-memory transport and real stdio subprocess).
