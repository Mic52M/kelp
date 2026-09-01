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

const LIVE_ONLY: RuleGroup[] = [
  {
    id: "RLS-002",
    title: "Row-Level Security (needs a live Supabase project)",
    rules: [
      "Missing RLS on user-facing tables",
      "Permissive policies (open to anon)",
      "Ownership-column heuristics (user_id / owner_id / created_by)",
    ],
  },
  {
    id: "EDGE-003 (live)",
    title: "Edge function replay (needs the deployed URL)",
    rules: [
      "Replay non-mutating functions without a JWT",
      "Compare vs an authenticated baseline",
    ],
  },
  {
    id: "BOLA-004",
    title: "Broken object-level authz (needs two test accounts + consent)",
    rules: [
      "user A tries to read user B's resources by id",
      "Manual review only, never auto-fixed",
    ],
  },
  {
    id: "AGENT-∞",
    title: "Multi-specialist agent squad (needs ANTHROPIC_API_KEY)",
    rules: [
      "postgrest / edge-fn / auth / secrets specialists probe in parallel",
      "Every finding evidence-gated — the executor re-runs the reproduction",
      "Reviewer confirms or drops each lead before it lands in the report",
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

  out.write(`${col("▶ Live (hosted app / future CLI agent mode)", BOLD)}\n\n`);
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
