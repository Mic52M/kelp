#!/usr/bin/env node

// kelp — security scanner CLI for vibe-coded apps.
//
// Standalone entry point. Uses the same detection engine (@kelp/core) as
// the hosted app and the GitHub Action, so what you see locally is what CI
// would see.

import { runScan } from "./commands/scan.js";
import { listRules } from "./commands/list-rules.js";
import { explain } from "./commands/explain.js";
import { loadConfig, suggestedConfigPath } from "./config.js";
import { isDepth, type Depth } from "./agent/depth.js";

const VERSION = "0.5.0";

function usageTop(): void {
  process.stdout.write(`kelp — security scanner for vibe-coded apps

USAGE
  kelp scan <path> [options]     scan a local directory
  kelp explain                   the manual — read this first
  kelp list-rules                every check the CLI runs, with rule ids
  kelp config                    show effective config
  kelp --version                 print version

Run \`kelp scan --help\` for scan-specific options.
Run \`kelp explain\` for the full guide.

Docs: https://kelp.build/docs · Source: https://github.com/Mic52M/kelp
`);
}

function usageScan(): void {
  process.stdout.write(`kelp scan <path> — scan a directory

OPTIONS
  --agent                    Run the multi-agent scan on top of the static
                             checks. Requires ANTHROPIC_API_KEY.
  --depth <preset>           quick | standard (default) | thorough | paranoid
                             — sets model + cost cap + iterations at once.
  --focus <classes>          Comma-separated: secrets,auth,rls,edge-fn,redirects
                             Narrows the agent to those classes only.
  --observations             Surface the agent's soft hints as a separate
                             section (not mixed with verified findings).
  --dry-run                  Show what would be scanned + estimated cost
                             without calling Anthropic.
  --report <file>            Write a full report to <file>. Extension picks
                             the format: .html (styled) or .md (Markdown).
  --model <id>               Override the depth preset's model.
  --max-cost-cents <n>       Override the depth preset's cost cap.
  --max-iterations <n>       Override the depth preset's iteration cap.
  --static-only              Skip the agent (default when --agent absent).
  --no-static                Skip the static checks, agent only.
  --json                     Emit findings as JSON on stdout.
  --severity <sev>           Only include findings at or above <sev>.
                             (critical | high | medium | low)
  --verbose, -V              Print per-check progress to stderr.
  --help, -h                 Show this help.

EXAMPLES
  kelp scan ./my-app
  kelp scan . --agent --depth thorough --report audit.html
  kelp scan . --agent --focus auth,rls
  kelp scan . --json > findings.json

EXIT CODES
  0   No findings above the severity floor
  1   At least one finding above the floor
  2   Scan failed (bad path, invalid flag, missing key)

See \`kelp explain\` for the full manual (depth trade-offs, safety model, etc.).
`);
}

function maybeFirstRunHint(): void {
  // If neither ANTHROPIC_API_KEY nor a config file is present, one-line hint
  // pointing at the manual. Printed to stderr so it never contaminates
  // --json output on stdout.
  const c = loadConfig();
  if (!c.anthropicApiKey) {
    process.stderr.write(
      `  (tip: no ANTHROPIC_API_KEY set — agent mode disabled. Run \`kelp explain\` for the full guide.)\n\n`,
    );
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    usageTop();
    process.exit(0);
  }
  if (cmd === "--version" || cmd === "-v" || cmd === "version") {
    process.stdout.write(`kelp v${VERSION}\n`);
    process.exit(0);
  }

  if (cmd === "explain") {
    explain();
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
    if (rest.includes("--help") || rest.includes("-h")) {
      usageScan();
      process.exit(0);
    }
    const targetPath = rest.find((a) => !a.startsWith("--") && !a.startsWith("-"));
    if (!targetPath) {
      process.stderr.write("kelp scan: missing <path>. Run `kelp scan --help` for usage.\n");
      process.exit(2);
    }
    const json = rest.includes("--json");
    const verbose = rest.includes("--verbose") || rest.includes("-V");
    const agent = rest.includes("--agent");
    const observations = rest.includes("--observations");
    const dryRun = rest.includes("--dry-run");
    const staticOnly = rest.includes("--static-only");
    const noStatic = rest.includes("--no-static");

    const sevIdx = rest.indexOf("--severity");
    const minSeverity = sevIdx >= 0 ? (rest[sevIdx + 1] ?? null) : null;
    const modelIdx = rest.indexOf("--model");
    const model = modelIdx >= 0 ? rest[modelIdx + 1] : undefined;
    const costIdx = rest.indexOf("--max-cost-cents");
    const maxCostCents = costIdx >= 0 ? Number(rest[costIdx + 1]) : undefined;
    const iterIdx = rest.indexOf("--max-iterations");
    const maxIterations = iterIdx >= 0 ? Number(rest[iterIdx + 1]) : undefined;
    const reportIdx = rest.indexOf("--report");
    const reportPath = reportIdx >= 0 ? rest[reportIdx + 1] ?? null : null;
    if (reportIdx >= 0 && !reportPath) {
      process.stderr.write("kelp scan: --report needs a filename (e.g. --report audit.html)\n");
      process.exit(2);
    }

    const depthIdx = rest.indexOf("--depth");
    const depthRaw = depthIdx >= 0 ? rest[depthIdx + 1] ?? null : null;
    let agentDepth: Depth | null = null;
    if (depthRaw) {
      if (!isDepth(depthRaw)) {
        process.stderr.write(`kelp scan: invalid --depth "${depthRaw}". Use quick, standard, thorough, or paranoid.\n`);
        process.exit(2);
      }
      agentDepth = depthRaw;
    }

    const focusIdx = rest.indexOf("--focus");
    const focus =
      focusIdx >= 0 && rest[focusIdx + 1]
        ? rest[focusIdx + 1]!
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : null;

    // First-run hint printed once when the caller hasn't asked for --agent
    // but also hasn't got a key on file — helps them find the guide.
    if (!agent && !json) maybeFirstRunHint();

    await runScan({
      path: targetPath,
      json,
      minSeverity,
      verbose,
      version: VERSION,
      runAgentAfter: agent,
      staticOnly,
      noStatic,
      agentDepth,
      model,
      maxCostCents,
      maxIterations,
      focus,
      observations,
      dryRun,
      reportPath,
    });
    return;
  }

  process.stderr.write(`Unknown command: ${cmd}. Run \`kelp --help\`.\n`);
  process.exit(2);
}

main().catch((e) => {
  process.stderr.write(`kelp: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(2);
});
