// `kelp list-rules` — introspect what the CLI actually checks.
//
// Answers the "what are you scanning for?" question without needing a
// scan run. Every rule listed here is exercised by `kelp scan` in the
// static phase.

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const col = (s: string, code: string) => (USE_COLOR ? `${code}${s}${RESET}` : s);

interface RuleGroup {
  id: string;
  title: string;
  rules: string[];
}

const STATIC: RuleGroup[] = [
  {
    id: "SEC-001",
    title: "Hardcoded secrets",
    rules: [
      "Stripe live secret keys (sk_live_…)",
      "Supabase service_role JWTs",
      "AWS access keys (AKIA…, ASIA…)",
      "GCP service account private keys",
      "GitHub personal access tokens (ghp_…, gho_…)",
      "OpenAI keys (sk-…) — includes project keys (see issue #49)",
      "Anthropic keys (sk-ant-…) — see issue #48",
      "Slack tokens (xoxb-…, xoxa-…)",
      "Twilio account SIDs + tokens",
      "SendGrid keys (SG.…)",
      "Generic high-entropy strings in client-side files",
      "Entropy fallback across the source tree",
    ],
  },
  {
    id: "EDGE-003",
    title: "Supabase config",
    rules: ["verify_jwt=false in supabase/config.toml (per-function)"],
  },
  {
    id: "RECON",
    title: "Edge function discovery (informational)",
    rules: [
      "Enumerate supabase/functions/*/index.ts",
      "Classify mutating vs non-mutating (name + body heuristics)",
      "Extract body / query params (best-effort)",
    ],
  },
];

const AGENT: RuleGroup[] = [
  {
    id: "AGENT",
    title: "Multi-agent scan · `kelp scan --agent` (needs ANTHROPIC_API_KEY)",
    rules: [
      "Autonomous Claude-driven auditor reads the repo source",
      "Toolbox: list_files, read_file, grep, report_finding",
      "Evidence-gated: every finding requires a source_contains substring",
      "Executor re-verifies the substring — rejects any lead it can't cite",
      "Cost + iteration caps enforced (--max-cost-cents, --max-iterations)",
      "Focus classes: verify_jwt=false, missing auth checks in server actions,",
      "  open redirects, client-side backend secret leaks, and more",
    ],
  },
];

const LIVE_ONLY: RuleGroup[] = [
  {
    id: "RLS-002",
    title: "Row-Level Security (hosted app only — needs a live Supabase project)",
    rules: [
      "Missing RLS on user-facing tables",
      "Permissive policies (open to anon)",
      "Ownership-column heuristics (user_id / owner_id / created_by)",
    ],
  },
  {
    id: "EDGE-003 (live)",
    title: "Edge function replay (hosted app only — needs the deployed URL)",
    rules: [
      "Replay non-mutating functions without a JWT",
      "Compare vs an authenticated baseline",
    ],
  },
  {
    id: "BOLA-004",
    title: "Broken object-level authz (hosted app only — needs two test accounts + consent)",
    rules: [
      "user A tries to read user B's resources by id",
      "Manual review only, never auto-fixed",
    ],
  },
];

export function listRules(): void {
  const out = process.stdout;
  out.write("\n");
  out.write(`${col("kelp", BOLD)} — checks available on the CLI\n\n`);

  out.write(`${col("▶ Static (run today by `kelp scan`)", BOLD)}\n\n`);
  for (const g of STATIC) {
    out.write(`  ${col(g.id, DIM)}  ${col(g.title, BOLD)}\n`);
    for (const r of g.rules) out.write(`    · ${r}\n`);
    out.write("\n");
  }

  out.write(`${col("▶ Agent-driven (kelp scan --agent, needs ANTHROPIC_API_KEY)", BOLD)}\n\n`);
  for (const g of AGENT) {
    out.write(`  ${col(g.id, DIM)}  ${col(g.title, BOLD)}\n`);
    for (const r of g.rules) out.write(`    · ${r}\n`);
    out.write("\n");
  }

  out.write(`${col("▶ Live (hosted app only)", BOLD)}\n\n`);
  for (const g of LIVE_ONLY) {
    out.write(`  ${col(g.id, DIM)}  ${col(g.title, BOLD)}\n`);
    for (const r of g.rules) out.write(`    · ${r}\n`);
    out.write("\n");
  }

  out.write(
    col(
      "Full coverage in docs: https://github.com/Mic52M/kelp/blob/master/docs/CLI.md\n",
      DIM,
    ),
  );
}
