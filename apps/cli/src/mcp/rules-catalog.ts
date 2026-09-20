// Machine-readable catalog of every rule the MCP server can talk about.
// This is what tools like list_rules and explain_rule read from, and what
// the kelp://rules resource serves.
//
// Keep in sync with:
//   - packages/core/src/scanners/secrets.ts (secret provider rules)
//   - apps/cli/src/checks/verify-jwt.ts (edge-fn config)
//   - apps/cli/src/commands/list-rules.ts (the human CLI view)
//
// The catalog is intentionally denormalized (`title`, `why`, `remediation`
// inline) because the audience is an LLM, not a rule engine. The LLM needs
// enough context in one shot to explain the finding and produce a fix.

export type RuleClass = "secret" | "auth" | "rls" | "edge-fn" | "misc";
export type RuleAvailability = "static" | "agent" | "live";
export type RuleSeverity = "critical" | "high" | "medium" | "low";

export interface RuleSpec {
  /** Unique id, must match the id emitted by the underlying scanner. */
  id: string;
  /** Short human title, one line. */
  title: string;
  /** Broad category, used for grouping in the UI. */
  class: RuleClass;
  /** Default severity when reported. May be bumped by the client-side heuristic. */
  severity: RuleSeverity;
  /** Where the rule runs (offline static, LLM agent, live app-only). */
  availability: RuleAvailability;
  /** Why the finding matters. Two or three sentences the LLM can quote. */
  why: string;
  /** Fix pattern. Not code, an intent the LLM can turn into a fix. */
  remediation: string;
}

export const RULES_CATALOG: RuleSpec[] = [
  // Provider secrets (secrets.ts).
  {
    id: "stripe-secret-live",
    title: "Stripe live secret key",
    class: "secret",
    severity: "critical",
    availability: "static",
    why: "A live Stripe secret key can charge cards, refund customers, and read your live payment data. Once it is public on GitHub it is compromised, even after removal, because the git object is still fetchable.",
    remediation: "Rotate the key at Stripe immediately, move it into a server-only env var, and never bundle it into client code.",
  },
  {
    id: "stripe-secret-test",
    title: "Stripe test secret key",
    class: "secret",
    severity: "high",
    availability: "static",
    why: "Test-mode keys cannot charge real cards but still expose your test data and give attackers a working handle into your Stripe account structure.",
    remediation: "Rotate the key at Stripe, move it into a server-only env var, and avoid committing it even in fixtures.",
  },
  {
    id: "stripe-webhook-secret",
    title: "Stripe webhook signing secret",
    class: "secret",
    severity: "high",
    availability: "static",
    why: "A leaked whsec_ lets anyone forge signed webhook payloads and bypass the receiving service's authenticity check, which means arbitrary state changes can be triggered by an attacker.",
    remediation: "Rotate the webhook signing secret in the Stripe dashboard, move it into a server-only env var, and verify signatures on every webhook route.",
  },
  {
    id: "aws-access-key-id",
    title: "AWS access key ID",
    class: "secret",
    severity: "high",
    availability: "static",
    why: "Even alone, an AWS access key id narrows the search space. Combined with the very common paired secret key leak, this becomes a full account takeover vector.",
    remediation: "Deactivate the key in IAM, rotate through a role or a fresh key, and audit CloudTrail for use between commit and revocation.",
  },
  {
    id: "github-token",
    title: "GitHub access token",
    class: "secret",
    severity: "high",
    availability: "static",
    why: "A leaked GitHub token can read private repos, push code, and open PRs as the token owner. On a CI account, that is a supply-chain compromise.",
    remediation: "Revoke the token at github.com/settings/tokens, rotate through a fine-grained PAT or a GitHub App, and audit repo activity since the commit.",
  },
  {
    id: "github-pat-fine",
    title: "GitHub fine-grained PAT",
    class: "secret",
    severity: "high",
    availability: "static",
    why: "Fine-grained PATs are still bearer tokens. Their narrower scope reduces blast radius but does not remove it, especially if the token has repo write.",
    remediation: "Revoke the PAT and reissue with the minimum scopes actually needed.",
  },
  {
    id: "anthropic-key",
    title: "Anthropic API key",
    class: "secret",
    severity: "critical",
    availability: "static",
    why: "An Anthropic API key can spend the account's balance and read message history. Costs can escalate to hundreds of dollars in hours if abused.",
    remediation: "Rotate at console.anthropic.com, move to a server env var, and set a monthly usage cap.",
  },
  {
    id: "openai-project-key",
    title: "OpenAI project-scoped API key",
    class: "secret",
    severity: "critical",
    availability: "static",
    why: "sk-proj-... project keys have organization-wide blast radius on the OpenAI side and can be used to spend the balance.",
    remediation: "Rotate at platform.openai.com, move to a server env var, set spend limits on the project.",
  },
  {
    id: "openai-key",
    title: "OpenAI API key",
    class: "secret",
    severity: "high",
    availability: "static",
    why: "A leaked OpenAI key can spend account balance and access model usage history.",
    remediation: "Rotate at platform.openai.com and set a spend limit on the affected project.",
  },
  {
    id: "google-api-key",
    title: "Google / Firebase API key",
    class: "secret",
    severity: "medium",
    availability: "static",
    why: "Google / Firebase API keys are usually origin-restricted on the client, but an unrestricted key or one used server-side can incur billing and expose services.",
    remediation: "Rotate in the Google Cloud console, add HTTP referrer or IP restrictions, and confirm it is not a service-account key by accident.",
  },
  {
    id: "slack-token",
    title: "Slack token",
    class: "secret",
    severity: "high",
    availability: "static",
    why: "Slack tokens can read messages, post as bots, and depending on scope, invite users or exfiltrate DM history.",
    remediation: "Revoke the token in the Slack admin panel, reissue with the minimum scopes, and audit the bot's message log.",
  },
  {
    id: "private-key-block",
    title: "Private key block",
    class: "secret",
    severity: "critical",
    availability: "static",
    why: "A PEM-formatted private key in the repo means whichever service uses that keypair is now impersonable by any reader of the repo.",
    remediation: "Rotate the keypair immediately, deploy the public half, and if the key was used for signing artifacts, treat all prior artifacts as suspect.",
  },
  {
    id: "supabase-service-role",
    title: "Supabase service_role JWT",
    class: "secret",
    severity: "critical",
    availability: "static",
    why: "The service_role key bypasses RLS and gives read plus write to every table in the project. If it ships to the browser or leaks to GitHub, the database is fully compromised.",
    remediation: "Rotate the service_role key in the Supabase dashboard, replace it with the anon key on the client, and gate any service_role use behind a server function.",
  },
  {
    id: "jwt-exposed",
    title: "Exposed signed JWT",
    class: "secret",
    severity: "high",
    availability: "static",
    why: "A JWT in source code is either a session token that should never be committed, or a signing artifact whose secret is likely near.",
    remediation: "Rotate whatever signing key produced the JWT, treat any session it authorized as compromised, and remove the value from git history.",
  },
  {
    id: "high-entropy-string",
    title: "High-entropy string",
    class: "secret",
    severity: "medium",
    availability: "static",
    why: "The value looks like a credential by shape and entropy but does not match a known provider pattern. Likely still a secret, treat as suspicious until proven otherwise.",
    remediation: "Inspect the value. If it is a real credential, rotate at the provider and move to an env var. If it is a legitimate hash or nonce, add it to your ignore list.",
  },

  // Edge function config (verify-jwt.ts).
  {
    id: "supabase-config-verify-jwt-false",
    title: "Supabase edge function skips JWT check (verify_jwt = false)",
    class: "edge-fn",
    severity: "high",
    availability: "static",
    why: "verify_jwt = false in supabase/config.toml disables the built-in JWT verification for that function, meaning it accepts any unauthenticated caller. Usually a mistake, sometimes a public-by-design function that then must gate on a shared secret in the handler.",
    remediation: "Set verify_jwt = true (or remove the override). If the function is intentionally public, gate it on a shared secret in the request headers and validate it at the top of the handler.",
  },
];

/** Lookup by id, returns undefined for unknown rules. */
export function findRule(id: string): RuleSpec | undefined {
  return RULES_CATALOG.find((r) => r.id === id);
}
