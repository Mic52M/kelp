-- 0014 — Per-finding chat conversations (#39).
--
-- Users can chat with an LLM about a single finding: "why is this
-- exploitable?", "walk me through the fix". The conversation is bounded to
-- that finding — the API and the LLM system prompt both refuse anything
-- else. Persistence lets a user come back and see the thread instead of
-- restarting from zero.
--
-- Threat model:
--   * Direct injection — user tries to jailbreak.
--   * Indirect injection — the finding's evidence text (code snippets, HTTP
--     responses persisted on findings.raw / scans.agent_report) may contain
--     attacker-authored content that becomes part of the chat context.
-- Defence in depth is in packages/core/src/agent/chat.ts — this migration
-- only stores the outcome (sanitized transcript). No tools are ever attached
-- to the chat LLM, and the finding_id gate prevents cross-finding leakage.
--
-- RLS: users can read/write only conversations on findings in orgs they
-- belong to. Enforced via the existing `kelp_is_member(org_id)` helper from
-- migration 0002. The service role bypasses RLS for the server-side writer.

begin;

create table finding_conversations (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references findings(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,

  -- Chat history: [{role: "user"|"assistant", content: string, ts: iso}]
  -- Cap enforced in application code (max 20 turns) so a runaway client
  -- can't blow up the row. Sanitized before persistence.
  messages jsonb not null default '[]'::jsonb,
  turn_count integer not null default 0
    check (turn_count >= 0 and turn_count <= 40),

  -- Rate-limit accounting. `hourly_count` is decayed by the application
  -- when we read it (compare against `hourly_window_start`); no cron.
  hourly_count integer not null default 0,
  hourly_window_start timestamptz not null default now(),

  -- Audit — Kelp's honesty invariant: every LLM turn we ran is on the row.
  -- Cost is folded into scans.cost_cents at the scan level; per-conversation
  -- cost lives here so we can spot abuse patterns per-user later.
  total_input_tokens bigint not null default 0,
  total_output_tokens bigint not null default 0,
  estimated_cost_micro_cents bigint not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One conversation per finding per user is what the UI wants. We don't
  -- carry user_id on this row (finding is already org-scoped), so we key on
  -- finding_id alone: everyone in the org shares the thread. Change if a
  -- future requirement wants per-user threads.
  constraint finding_conversations_finding_id_uniq unique (finding_id)
);

create index finding_conversations_org_updated_idx
  on finding_conversations (org_id, updated_at desc);

-- RLS: readers must be a member of the row's org; writes go through the
-- service role. Same shape as `findings` in migration 0002.
alter table finding_conversations enable row level security;

create policy finding_conversations_select_org
  on finding_conversations for select
  to authenticated
  using (kelp_is_member(org_id));

-- No INSERT/UPDATE/DELETE grants for authenticated — the API writes as
-- service_role and enforces its own auth. Explicit denies for clarity.
revoke insert, update, delete on finding_conversations from authenticated;

commit;
