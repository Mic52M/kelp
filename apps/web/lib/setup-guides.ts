// Per-field setup content shown under each Settings input as a collapsible
// SetupGuide. The audience is a vibe coder who built with Lovable / Bolt /
// Cursor / v0 on Vercel + Supabase and does not always know where the tokens
// live — so every guide follows the same shape:
//
//   what it is  →  where to get it (per platform)  →  or: prompt your AI tool
//
// This module is presentational content only; the components render it.
// Keeping content out of JSX means we can add a new platform in one place.

export interface PlatformStep {
  platform: "Supabase" | "Vercel" | "Lovable" | "Bolt";
  steps: string[];
  /** Optional external link the last step references. */
  link?: { label: string; href: string };
}

export interface AiPrompt {
  /** Where the user should paste this. "Supabase SQL editor" or "your AI IDE". */
  target: string;
  /** The verbatim text to copy. Use ${…} placeholders sparingly. */
  body: string;
}

export interface SetupGuideContent {
  /** ~1 sentence, plain English. */
  whatIsIt: string;
  /** Per-platform steps (usually 3–4 lines each). */
  platforms: PlatformStep[];
  /** Optional AI prompt block — omit when it doesn't make sense (e.g. tokens). */
  prompt?: AiPrompt;
  /** Optional short warning shown above the prompt (e.g. rotate on suspicion). */
  caveat?: string;
}

// ─── Supabase read-only connection string ────────────────────────────────────

export const SUPABASE_READONLY_ROLE_SQL = `-- Kelp read-only role — paste in Supabase → SQL Editor, replace the password,
-- then click Run. After the role is created, grab the CONNECTION STRING from
-- Supabase → Project Settings → Database → Connect → "Session pooler" (or
-- "Transaction pooler"), then rewrite it as described below.

create role kelp_readonly with login password 'CHANGE_ME_STRONG_PASSWORD';

grant connect on database postgres to kelp_readonly;
grant usage on schema public to kelp_readonly;
grant usage on schema pg_catalog to kelp_readonly;
grant select on pg_catalog.pg_class      to kelp_readonly;
grant select on pg_catalog.pg_namespace  to kelp_readonly;
grant select on pg_catalog.pg_policies   to kelp_readonly;
grant usage on schema information_schema to kelp_readonly;
grant select on information_schema.columns to kelp_readonly;

alter default privileges in schema public revoke select on tables from kelp_readonly;

-- ─── HOW TO BUILD THE CONNECTION STRING ────────────────────────────────────
--
-- Do NOT use the "Direct connection" URL (db.<ref>.supabase.co) — it is
-- IPv6-only for new projects and most networks (including Vercel/Railway/
-- most dev machines) cannot reach it, giving ENOTFOUND.
--
-- Use the POOLER URL from Supabase → Settings → Database → Connect:
--   postgres://postgres.<ref>:<pass>@aws-0-<region>.pooler.supabase.com:6543/postgres
--
-- Rewrite it for Kelp — two edits:
--   1. Replace  postgres.<ref>          with  kelp_readonly.<ref>
--      (the pooler uses "<db_user>.<projectref>" as the username, so a
--       custom role slots in the same way as the default 'postgres' user)
--   2. Replace  <pass>                  with  CHANGE_ME_STRONG_PASSWORD
--
-- Final shape you paste back in Kelp:
--   postgres://kelp_readonly.<ref>:CHANGE_ME_STRONG_PASSWORD@aws-0-<region>.pooler.supabase.com:6543/postgres`;

export const SUPABASE_READONLY_GUIDE: SetupGuideContent = {
  whatIsIt:
    "A least-privilege Postgres role Kelp uses to read your schema and RLS policies — never your application data.",
  platforms: [
    {
      platform: "Supabase",
      steps: [
        "Open your project in Supabase → SQL Editor (left sidebar).",
        "Paste the SQL below, replace CHANGE_ME_STRONG_PASSWORD with a real password (save it — it's not recoverable), then Run.",
        "Grab the pooler URL from Project Settings → Database → Connect → Session pooler (or Transaction pooler). It looks like postgres://postgres.<ref>:<pass>@aws-0-<region>.pooler.supabase.com:6543/postgres — do NOT use the Direct connection, it's IPv6-only and most networks reject it.",
        "In that URL: replace postgres.<ref> with kelp_readonly.<ref>, and replace the password with the one you picked. Paste the result in the field above.",
      ],
      link: { label: "Open Supabase SQL Editor", href: "https://supabase.com/dashboard/project/_/sql/new" },
    },
    {
      platform: "Vercel",
      steps: [
        "Supabase runs the SQL, not Vercel — but if you keep a `DATABASE_URL` in Vercel it's usually the pooled one already.",
        "Even so, don't paste your `DATABASE_URL` here: it likely has admin privileges. Create the read-only role above instead.",
      ],
    },
    {
      platform: "Lovable",
      steps: [
        "Lovable talks to Supabase directly — this is a Supabase operation.",
        "In your Lovable project → click the Supabase icon → open the Supabase dashboard, then follow the Supabase steps.",
      ],
    },
    {
      platform: "Bolt",
      steps: [
        "Bolt.new stores its Supabase config under Integrations → Supabase.",
        "Click through to your Supabase project and follow the Supabase steps.",
      ],
    },
  ],
  prompt: {
    target: "Supabase → SQL Editor",
    body: SUPABASE_READONLY_ROLE_SQL,
  },
  caveat:
    "Kelp validates the connection before saving it. If Postgres rejects the role, the SQL didn't run cleanly — check for a typo in the password.",
};

// ─── Supabase Management API token ───────────────────────────────────────────

export const SUPABASE_MGMT_TOKEN_GUIDE: SetupGuideContent = {
  whatIsIt:
    "A Supabase account-level token. Only use this if you can't create the read-only role above — it has broader access.",
  platforms: [
    {
      platform: "Supabase",
      steps: [
        "Go to Supabase → Account → Access Tokens.",
        "Click Generate new token, name it \"Kelp\", copy the value once (Supabase won't show it again).",
        "Paste it in the field above.",
      ],
      link: {
        label: "Open Supabase → Access Tokens",
        href: "https://supabase.com/dashboard/account/tokens",
      },
    },
    {
      platform: "Vercel",
      steps: ["Not applicable — this token lives in Supabase, not Vercel."],
    },
    {
      platform: "Lovable",
      steps: [
        "Lovable connects to Supabase via your Supabase account.",
        "Open your Supabase account in a new tab and follow the Supabase steps.",
      ],
    },
    {
      platform: "Bolt",
      steps: [
        "Bolt uses your Supabase account under the hood.",
        "Open Supabase in a new tab and follow the Supabase steps.",
      ],
    },
  ],
  caveat:
    "Prefer the read-only role above whenever possible. Rotate this token from Supabase if you suspect leakage.",
};

// ─── Deploy URL ──────────────────────────────────────────────────────────────

export const APP_BASE_URL_GUIDE: SetupGuideContent = {
  whatIsIt:
    "The URL where your app is actually deployed — the specialists send live HTTP probes to this address. Use a staging URL if you'd rather not touch production.",
  platforms: [
    {
      platform: "Vercel",
      steps: [
        "Open your project on Vercel → the Domains section lists your production URL (e.g. myapp.vercel.app).",
        "Copy the https:// URL and paste it in the field above.",
      ],
    },
    {
      platform: "Lovable",
      steps: [
        "Open your Lovable project → click Publish (top right).",
        "The published URL appears under \"Your project is live at\". Copy it.",
      ],
    },
    {
      platform: "Bolt",
      steps: [
        "Bolt.new → Deploy → Netlify → your live URL is shown after the first deploy.",
        "Copy the https:// URL.",
      ],
    },
    {
      platform: "Supabase",
      steps: ["Not applicable — Supabase is your backend, not your app URL."],
    },
  ],
  caveat:
    "Prefer a staging URL if you have one. Kelp runs read-only probes, but consent v3 lets you scope where they land.",
};

// ─── Two test accounts ───────────────────────────────────────────────────────

export const TEST_ACCOUNTS_AI_PROMPT = `I'm setting up a security scanner (Kelp) that needs two test-user accounts in
my app to check for cross-user data leaks. Please:

1. Sign up (through the exact same signup flow real users use, so RLS + auth
   triggers all fire) two new users:

     Account A → email: a@kelp-test.local, password: kelp-test-a-<random-12-chars>
     Account B → email: b@kelp-test.local, password: kelp-test-b-<random-12-chars>

2. Have Account A create one small piece of data (e.g. one record in your main
   table — an order, a note, whatever your app centers on). Same for Account B.

3. Reply with the exact email + password pair for each account so I can paste
   them into Kelp Settings. Do NOT commit them anywhere.

Rules:
 - Use the real signup path, not raw SQL — Kelp needs the same auth session
   type a real user gets.
 - Never share these credentials outside this chat.
 - I'll rotate/delete them from my app after testing.`;

export const TEST_ACCOUNTS_GUIDE: SetupGuideContent = {
  whatIsIt:
    "Two low-privilege accounts on your app that Kelp signs in as, to check whether user A can accidentally read user B's data. Credentials are stored encrypted; only Kelp sees them.",
  platforms: [
    {
      platform: "Lovable",
      steps: [
        "In your Lovable chat, paste the AI prompt below.",
        "Lovable creates the two users via your app's real signup path and replies with the credentials.",
        "Paste each email + password into A and B above.",
      ],
    },
    {
      platform: "Bolt",
      steps: [
        "In your Bolt chat, paste the AI prompt below.",
        "Bolt runs the signup for both accounts and returns credentials.",
        "Paste them into A and B above.",
      ],
    },
    {
      platform: "Vercel",
      steps: [
        "Vercel just hosts — do the signup from your app's public sign-up page instead.",
        "Or paste the AI prompt into Cursor / your IDE and let it drive the signup.",
      ],
    },
    {
      platform: "Supabase",
      steps: [
        "You can also add them from Supabase → Authentication → Users → Add user.",
        "Then have each user create one row in your main table via your app (not the SQL editor) so RLS is exercised.",
      ],
    },
  ],
  prompt: {
    target: "your AI IDE (Lovable / Bolt / Cursor)",
    body: TEST_ACCOUNTS_AI_PROMPT,
  },
  caveat:
    "Kelp probes only these two accounts against each other. Delete or rotate them from your app when you're done testing.",
};
