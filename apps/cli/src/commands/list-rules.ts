// `kelp list-rules` — introspect what the CLI actually checks.
//
// Answers the "what are you scanning for?" question without needing a
// scan run. Every rule listed here is exercised by `kelp scan` in the
// static phase.

import { paint, BOLD, DIM } from "../ui/style.js";

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
  {
    id: "RLS-DEEP",
    title: "Static RLS analysis over supabase/migrations/*.sql",
    rules: [
      "fk_leak_to_unprotected — RLS table whose foreign key points at a table with no RLS",
      "command_scope_gap — policy covers some commands but leaves INSERT/UPDATE/DELETE open",
      "view_bypasses_rls — view over a protected table created without security_invoker = true",
    ],
  },
  {
    id: "STORAGE",
    title: "Static Supabase Storage ACL over migrations",
    rules: [
      "storage_public_bucket — bucket created with public = true",
      "storage_policy_missing_user_scope — objects policy with no auth.uid()/owner check",
      "storage_policy_permissive — USING (true) / WITH CHECK (true) for a client-facing role",
    ],
  },
  {
    id: "ROUTE-AUTH",
    title: "Next.js route + server-action auth checks (heuristic, medium confidence)",
    rules: [
      "route_handler_no_auth — app/**/route.ts or pages/api/** handler with no auth call",
      "server_action_no_auth — \"use server\" action reading formData with no auth call",
      "Reads (GET) flagged only when the file touches a backend; webhooks with a verified signature are skipped",
    ],
  },
  {
    id: "CLIENT-ENV",
    title: "Backend secrets exposed to the browser via a public env prefix",
    rules: [
      "client_exposed_secret — NEXT_PUBLIC_/VITE_/REACT_APP_/... var named SERVICE_ROLE, SECRET, PRIVATE_KEY, PASSWORD",
      "service_role in the client bundle bypasses RLS entirely (critical)",
      "anon and publishable keys are public by design and never flagged",
    ],
  },
  {
    id: "FIREBASE",
    title: "Firebase Firestore + Storage security rules (.rules files)",
    rules: [
      "firebase_rule_public — allow ...: if true (open to the internet)",
      "firebase_rule_unauthenticated_write — a write with no request.auth check",
      "firebase_rule_write_no_owner — a signed-in write with no owner binding (request.auth.uid)",
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
    id: "RLS-002 (live)",
    title: "Row-Level Security live probe (hosted app only — needs a live Supabase project)",
    rules: [
      "Confirms at runtime what the static RLS-DEEP checks flag from migrations",
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
  out.write(`${paint("kelp", BOLD)} — checks available on the CLI\n\n`);

  out.write(`${paint("▶ Static (run today by `kelp scan`)", BOLD)}\n\n`);
  for (const g of STATIC) {
    out.write(`  ${paint(g.id, DIM)}  ${paint(g.title, BOLD)}\n`);
    for (const r of g.rules) out.write(`    · ${r}\n`);
    out.write("\n");
  }

  out.write(`${paint("▶ Agent-driven (kelp scan --agent, needs ANTHROPIC_API_KEY)", BOLD)}\n\n`);
  for (const g of AGENT) {
    out.write(`  ${paint(g.id, DIM)}  ${paint(g.title, BOLD)}\n`);
    for (const r of g.rules) out.write(`    · ${r}\n`);
    out.write("\n");
  }

  out.write(`${paint("▶ Live (hosted app only)", BOLD)}\n\n`);
  for (const g of LIVE_ONLY) {
    out.write(`  ${paint(g.id, DIM)}  ${paint(g.title, BOLD)}\n`);
    for (const r of g.rules) out.write(`    · ${r}\n`);
    out.write("\n");
  }

  out.write(
    paint(
      "Full coverage in docs: https://github.com/Mic52M/kelp/blob/master/docs/CLI.md\n",
      DIM,
    ),
  );
}
