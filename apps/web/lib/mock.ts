import type { Finding, Project } from "./types";

// Representative demo data — the same shapes the scanners produce. Used until the
// real GitHub/Supabase connectors are wired (they need API credentials).

export const project: Project = {
  id: "prj_9f2a",
  name: "Roamly",
  repo: "acme/roamly-app",
  supabaseRef: "xkltpqwabcde",
  lastScan: "2 minutes ago",
};

export const findings: Finding[] = [
  {
    id: "fnd_01",
    vulnClass: "rls",
    severity: "critical",
    status: "open",
    title: 'Row Level Security is off on "bookings"',
    location: "public.bookings",
    explanation:
      "The bookings table is reachable through your project's API but Row Level Security is disabled. Anyone with your public anon key — which ships in your frontend — can read and write every row, including other users' reservations and payment references.",
    remediation:
      "Enable RLS and restrict each row to its owner via auth.uid() = user_id. Kelp has generated the migration for you to review.",
    fixPreview: `alter table "public"."bookings" enable row level security;

create policy "bookings_select_own" on "public"."bookings"
  for select using ((select auth.uid()) = "user_id");

create policy "bookings_insert_own" on "public"."bookings"
  for insert with check ((select auth.uid()) = "user_id");
-- + update / delete policies`,
    exposure: [
      { category: "email", count: 1840 },
      { category: "phone", count: 1203 },
    ],
    fixPrompt: `The Supabase table \`public.bookings\` is not secured: Row Level Security is turned off. Apply a migration so each user can only access their own rows (via \`auth.uid() = user_id\`) for select, insert, update and delete, then confirm the app still works for a logged-in user.`,
    detectedAt: "2m ago",
  },
  {
    id: "fnd_02",
    vulnClass: "secret",
    severity: "critical",
    status: "pr_opened",
    title: "Supabase service_role key committed to the frontend",
    location: "src/lib/supabaseClient.ts:12",
    explanation:
      "A Supabase service_role key was found in client-side code. This key bypasses Row Level Security entirely and grants full read/write access to your database. Because it ships in the browser bundle, any visitor can extract it.",
    remediation:
      "Move the key to a server-only environment variable and rotate it in the Supabase dashboard. Kelp opened a pull request that does the first step.",
    fixPreview: `#12  - const key = "eyJhbGciOi…service_role…"
#12  + const key = process.env.SUPABASE_SERVICE_ROLE_KEY!  // server only`,
    fixPrompt: `There is a hard-coded Supabase service_role secret in \`src/lib/supabaseClient.ts\` on line 12. Move it out of the code: read it from an environment variable named \`SUPABASE_SERVICE_ROLE_KEY\` instead, update every place that uses it, and make sure it is never sent to the browser. Then remind me to rotate the key in Supabase, since it was exposed.`,
    detectedAt: "2m ago",
  },
  {
    id: "fnd_03",
    vulnClass: "bola",
    severity: "high",
    status: "needs_review",
    title: "A user can read another user's invoice by ID",
    location: "GET /rest/v1/invoices?id=eq.{id}",
    explanation:
      "Using account A's session, Kelp was able to fetch an invoice that belongs to account B by changing the id in the request. Object-level authorization is not enforced on this endpoint.",
    remediation:
      "This finding is queued for human review by the Kelp team before it is confirmed. Broken object-level authorization fixes depend on your business logic, so we validate them manually rather than auto-generating a change.",
    detectedAt: "2m ago",
  },
  {
    id: "fnd_04",
    vulnClass: "secret",
    severity: "high",
    status: "open",
    title: "Stripe test secret key in repository",
    location: "server/checkout.ts:44",
    explanation:
      "A Stripe test secret key (sk_test_…) is hard-coded in the checkout handler. Test keys can still create charges and reveal your account structure; secrets should never be committed.",
    remediation:
      "Move it to an environment variable. Generate a fix to open a pull request.",
    detectedAt: "2m ago",
  },
  {
    id: "fnd_05",
    vulnClass: "rls",
    severity: "medium",
    status: "resolved",
    title: 'Rows in "profiles" were not limited to their owner',
    location: "public.profiles",
    explanation:
      "The profiles table had a policy scoped by organization rather than by user, so members could read each other's private profile fields. Fixed on 28 Jun.",
    remediation: "Resolved — verified on the last re-scan.",
    detectedAt: "resolved",
  },
];

export const summary = {
  score: 41, // 0–100 security posture
  critical: findings.filter((f) => f.severity === "critical" && f.status !== "resolved").length,
  high: findings.filter((f) => f.severity === "high" && f.status !== "resolved").length,
  medium: findings.filter((f) => f.severity === "medium" && f.status !== "resolved").length,
  resolved: findings.filter((f) => f.status === "resolved").length,
};

// The live scan steps the console animates through.
export const scanSteps = [
  "Connecting to Supabase Management API…",
  "Reading schema: 14 tables, 6 views",
  'Checking RLS on "profiles"…',
  'Checking RLS on "bookings"… policy missing',
  'Checking RLS on "payments"…',
  "Scanning repository acme/roamly-app for secrets…",
  "Analyzing 212 files, 18k lines",
  'Found: service_role key in src/lib/supabaseClient.ts',
  "Running active object-level authorization tests…",
  'Probing GET /rest/v1/invoices with two test sessions…',
  "Correlating findings and generating fixes…",
];
