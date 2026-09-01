#!/usr/bin/env node

// kelp — security scanner CLI for vibe-coded apps.
//
// This is the standalone entry point. It runs against a local directory using
// the same detection engine (@kelp/core) as the hosted app and the GitHub
// Action, so what you see locally is what CI would see.

import { runScan } from "./commands/scan.js";

const VERSION = "0.2.1";

function usage(): void {
  process.stdout.write(`kelp — security scanner for vibe-coded apps

USAGE
  kelp scan <path> [options]

COMMANDS
  scan <path>    Scan a local directory for hardcoded secrets and other vulns

OPTIONS
  --json                     Emit findings as JSON on stdout (machine-readable)
  --severity <critical|high|medium|low>
                             Only include findings at or above this severity
  --help, -h                 Show this help
  --version, -v              Print version

EXAMPLES
  kelp scan ./my-app
  kelp scan ./my-app --json > findings.json
  kelp scan . --severity high

EXIT CODES
  0   Scan completed and found no gating findings
  1   Scan completed and found at least one finding
  2   Scan failed to run (invalid input, unreadable path, etc.)

Docs: https://github.com/Mic52M/kelp/blob/master/docs/CLI.md
Report issues: https://github.com/Mic52M/kelp/issues
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

  if (cmd === "scan") {
    const rest = argv.slice(1);
    const targetPath = rest.find((a) => !a.startsWith("--"));
    if (!targetPath) {
      process.stderr.write("kelp scan: missing <path>. Run `kelp --help` for usage.\n");
      process.exit(2);
    }
    const json = rest.includes("--json");
    const sevIdx = rest.indexOf("--severity");
    const minSeverity = sevIdx >= 0 ? (rest[sevIdx + 1] ?? null) : null;
    await runScan({ path: targetPath, json, minSeverity, version: VERSION });
    return;
  }

  process.stderr.write(`Unknown command: ${cmd}. Run \`kelp --help\`.\n`);
  process.exit(2);
}

main().catch((e) => {
  process.stderr.write(`kelp: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(2);
});
