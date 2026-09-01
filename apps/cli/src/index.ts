#!/usr/bin/env node

// kelp — security scanner CLI for vibe-coded apps.
//
// Standalone entry point. Uses the same detection engine (@kelp/core) as
// the hosted app and the GitHub Action, so what you see locally is what CI
// would see.

import { runScan } from "./commands/scan.js";
import { listRules } from "./commands/list-rules.js";
import { loadConfig, suggestedConfigPath } from "./config.js";

const VERSION = "0.2.2";

function usage(): void {
  process.stdout.write(`kelp — security scanner for vibe-coded apps

USAGE
  kelp scan <path> [options]
  kelp list-rules
  kelp config

COMMANDS
  scan <path>        Scan a local directory for hardcoded secrets, edge-fn
                     misconfiguration, and other supported static classes
  list-rules         List every check the CLI runs, with rule ids
  config             Show the effective config (env + ~/.config/kelp/config.json)

OPTIONS (scan)
  --json                     Emit findings as JSON on stdout
  --severity <sev>           Only include findings at or above <sev>
                             (critical | high | medium | low)
  --verbose, -V              Print per-check progress to stderr
  --help, -h                 Show help
  --version, -v              Print version

EXAMPLES
  kelp scan ./my-app
  kelp scan ./my-app --json > findings.json
  kelp scan . --severity high
  kelp scan . --verbose

EXIT CODES
  0   Scan completed, no findings above the severity floor
  1   Scan completed, at least one finding above the floor
  2   Scan failed (bad path, unreadable target, invalid flag)

CONFIG
  ~/.config/kelp/config.json can carry an Anthropic API key for the
  upcoming agent-driven scan. ANTHROPIC_API_KEY env var wins over the file.

Docs: https://github.com/Mic52M/kelp/blob/master/docs/CLI.md
Issues: https://github.com/Mic52M/kelp/issues
`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    usage();
    process.exit(0);
  }
  if (cmd === "--version" || cmd === "-v" || cmd === "version") {
    process.stdout.write(`kelp v${VERSION}\n`);
    process.exit(0);
  }

  if (cmd === "list-rules") {
    listRules();
    process.exit(0);
  }

  if (cmd === "config") {
    const c = loadConfig();
    process.stdout.write(`kelp v${VERSION} — effective config\n\n`);
    process.stdout.write(`  anthropic api key   ${c.anthropicApiKey ? `set (${c.source})` : "not set"}\n`);
    process.stdout.write(`  config file         ${c.filePath ?? "(none — write to " + suggestedConfigPath() + ")"}\n`);
    process.stdout.write(
      `\nExample: create ${suggestedConfigPath()}\n{\n  "anthropicApiKey": "sk-ant-..."\n}\n`,
    );
    process.exit(0);
  }

  if (cmd === "scan") {
    const rest = argv.slice(1);
    const targetPath = rest.find((a) => !a.startsWith("--") && !a.startsWith("-"));
    if (!targetPath) {
      process.stderr.write("kelp scan: missing <path>. Run `kelp --help` for usage.\n");
      process.exit(2);
    }
    const json = rest.includes("--json");
    const verbose = rest.includes("--verbose") || rest.includes("-V");
    const sevIdx = rest.indexOf("--severity");
    const minSeverity = sevIdx >= 0 ? (rest[sevIdx + 1] ?? null) : null;
    await runScan({ path: targetPath, json, minSeverity, verbose, version: VERSION });
    return;
  }

  process.stderr.write(`Unknown command: ${cmd}. Run \`kelp --help\`.\n`);
  process.exit(2);
}

main().catch((e) => {
  process.stderr.write(`kelp: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(2);
});
