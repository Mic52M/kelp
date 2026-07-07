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
  /** Optional secondary block (e.g. raw SQL for a DB editor) shown after the
   *  AI prompt so vibe-coders get the copy-into-chat version FIRST. */
  secondary?: AiPrompt;
  /** Optional short warning shown above the prompt (e.g. rotate on suspicion). */
  caveat?: string;
}

// ─── Supabase read-only connection string ────────────────────────────────────

/**
 * Raw SQL for the DB editor. NOTE: no rewrite instructions in the SQL comment
 * itself — item #1 taught us that Supavisor won't route custom "<role>.<ref>"
 * usernames for new projects (ENOTFOUND). So the flow is now: create the role,
 * paste the STANDARD Session-pooler URL as-is, and Kelp SET ROLE at session
 * start (see connectors/supabase-pg.ts:connectAsReadonly).
 */
export const SUPABASE_READONLY_ROLE_SQL = `-- Kelp read-only role — paste in Supabase → SQL Editor and click Run.
-- Replace the password with something random before running (save it once —
-- Supabase does not show it again).

create role kelp_readonly with login password 'CHANGE_ME_STRONG_PASSWORD';

grant connect on database postgres to kelp_readonly;
grant usage on schema public to kelp_readonly;
grant usage on schema pg_catalog to kelp_readonly;
grant select on pg_catalog.pg_class      to kelp_readonly;
grant select on pg_catalog.pg_namespace  to kelp_readonly;
grant select on pg_catalog.pg_policies   to kelp_readonly;
grant select on pg_catalog.pg_attribute  to kelp_readonly;
grant select on pg_catalog.pg_type       to kelp_readonly;

-- Explicit "no reads on any of your data" — Kelp only needs catalog metadata.
alter default privileges in schema public revoke select on tables from kelp_readonly;

-- The current 'postgres' role is allowed to switch to this least-privilege
-- role at session start (that's how Kelp connects — see the setup guide).
grant kelp_readonly to postgres;`;

/**
 * Paste-into-Lovable/Bolt/Cursor prompt. Written as one continuous request a
 * vibe-coder can drop straight into their AI IDE chat — no manual SQL editing,
 * no rewrites, no clarifications needed. The AI runs the SQL for them, then
 * hands back both artifacts Kelp needs.
 */
export const SUPABASE_READONLY_AI_PROMPT = `I'm connecting my app to Kelp (a security scanner) and it needs a
least-privilege Postgres role on my Supabase project. Please do this end-to-end
for me and reply with two things at the end. Do NOT expose the password
outside this chat.

1. Pick a strong random password (16+ chars) for a new Postgres role named
   \`kelp_readonly\`. Remember it — I'll need it below.

2. Open my Supabase project's SQL editor and RUN exactly this SQL, replacing
   CHANGE_ME_STRONG_PASSWORD with the password you picked in step 1:

     create role kelp_readonly with login password 'CHANGE_ME_STRONG_PASSWORD';
     grant connect on database postgres to kelp_readonly;
     grant usage on schema public to kelp_readonly;
     grant usage on schema pg_catalog to kelp_readonly;
     grant select on pg_catalog.pg_class      to kelp_readonly;
     grant select on pg_catalog.pg_namespace  to kelp_readonly;
     grant select on pg_catalog.pg_policies   to kelp_readonly;
     grant select on pg_catalog.pg_attribute  to kelp_readonly;
     grant select on pg_catalog.pg_type       to kelp_readonly;
     alter default privileges in schema public revoke select on tables from kelp_readonly;
     grant kelp_readonly to postgres;

3. Grab the Session-pooler connection string from Supabase →
   Project Settings → Database → Connect → "Session pooler". It looks like:
     postgres://postgres.<ref>:<pass>@aws-0-<region>.pooler.supabase.com:5432/postgres
   Do NOT use the "Direct connection" URL — it is IPv6-only and most
   networks (including Vercel/Railway) can't reach it.
   Do NOT rewrite the username. Kelp handles the role switch itself; the
   URL must stay with \`postgres.<ref>\` as the user.

4. Reply with:
     (a) the Session-pooler URL from step 3, with the real password in place
         (this is the value I paste into Kelp), and
     (b) confirmation that the SQL from step 2 ran without errors.
   Do not commit the URL anywhere.`;

export const SUPABASE_READONLY_GUIDE: SetupGuideContent = {
  whatIsIt:
    "A least-privilege Postgres role Kelp uses to read your schema and RLS policies — never your application data.",
  platforms: [
    {
      platform: "Lovable",
      steps: [
        "In your Lovable chat, paste the AI prompt below.",
        "Lovable runs the SQL in your linked Supabase project and replies with the Session-pooler connection string.",
        "Paste that URL into the field above and click Save — Kelp verifies it before storing.",
      ],
    },
    {
      platform: "Bolt",
      steps: [
        "In your Bolt chat, paste the AI prompt below (Bolt has your Supabase project connected under Integrations).",
        "Bolt runs the SQL and returns the Session-pooler URL.",
        "Paste it into the field above.",
      ],
    },
    {
      platform: "Supabase",
      steps: [
        "Prefer the AI prompt below if you're using Lovable / Bolt / Cursor. If you'd rather do it yourself:",
        "Open Supabase → SQL Editor, paste the SQL from the \"Or paste this into Supabase → SQL Editor\" block, replace CHANGE_ME_STRONG_PASSWORD, and Run.",
        "Copy the URL from Project Settings → Database → Connect → \"Session pooler\" (not \"Direct connection\").",
        "Paste that URL AS-IS into the field above — Kelp switches to the read-only role automatically at session start.",
      ],
      link: {
        label: "Open Supabase SQL Editor",
        href: "https://supabase.com/dashboard/project/_/sql/new",
      },
    },
    {
      platform: "Vercel",
      steps: [
        "Supabase runs the SQL, not Vercel — but if you keep a DATABASE_URL in Vercel it's usually the pooled one already.",
        "Even so, don't paste your DATABASE_URL here: it likely has admin privileges. Create the read-only role first.",
      ],
    },
  ],
  prompt: {
    target: "your AI IDE (Lovable / Bolt / Cursor)",
    body: SUPABASE_READONLY_AI_PROMPT,
  },
  secondary: {
    target: "Supabase → SQL Editor",
    body: SUPABASE_READONLY_ROLE_SQL,
  },
  caveat:
    "Kelp verifies the URL by opening a connection and switching to the kelp_readonly role before storing anything. If verification fails, the SQL didn't run cleanly — check for typos in the password.",
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
