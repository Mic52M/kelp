# Evidence-gating

**The single most important invariant in Kelp.** The LLM never decides a
finding is real.

## Why this matters

LLM-driven security tools tend to hallucinate. They "find" vulnerabilities that
don't exist, misclassify severity, or describe fixes that would break more
than they fix. The trust cost is huge: one confidently-wrong finding erodes a
lot of correct ones.

Kelp's answer is a mechanical one: **every agent-produced lead has to come
with a reproduction, and the executor re-runs the reproduction before the
finding is recorded.** The model is trusted to reason about *where* to look
and *how* to probe; it is never trusted to conclude the vuln exists.

## The mechanism

Every agent (`postgrest`, `edge-fn`, `auth`, `secrets`, reviewer, follow-ups)
has access to a tool called `report_finding`. That tool takes:

- The vuln class + severity + title
- **A reproduction**, one of:
  - `probe`: an HTTP request the agent already ran, plus the expected
    observable (`status_2xx`, `returns_rows`, `row_owned_by_other`,
    `callback_fired`, `header_matches`)
  - `source_citation`: a path + a substring the agent claims to have read

When the agent calls `report_finding`, the executor **re-runs it independently**:

- For `probe`: replays the HTTP request from a fresh context and checks the
  observable holds. If the response no longer matches, the finding is
  silently dropped.
- For `source_citation`: reads the file and checks `source_contains` — the
  substring must appear at the claimed path.

Only findings that survive the re-run are persisted. Agents cannot fabricate
findings, misremember probes, or hallucinate file contents that don't exist.

## Where this lives

- The `report_finding` tool schema — `packages/core/src/agent/tools.ts`
- The executor's re-run logic — `packages/core/src/agent/executor.ts`
- The observable checkers — `packages/core/src/agent/checkers.ts`
- The reviewer loop that vets follow-up leads — `packages/core/src/agent/reviewer.ts`

## What the reviewer adds

After the primary specialists finish, a **reviewer** reads the tail of each
specialist's transcript (last 10 steps × 1.5 KB, keeps token cost bounded)
and queues up to 3 follow-up leads. Each follow-up becomes a small specialist
of its own with an 8-step budget, tight brief, and the same evidence gate.

The reviewer only ever narrows the finding set — it drops leads, downgrades
severity, or spawns confirmation follow-ups. It never adds noise.

## Failure isolation

- If the reviewer crashes, the primary specialists' findings still land.
- If a follow-up crashes, other follow-ups still run.
- If the executor's re-run itself fails (network glitch, throttling), the
  finding is dropped, not persisted with a caveat — a "maybe" finding is
  worse than none in this domain.

## Why we don't `try/except` around this

If the re-run fails, we drop the finding. If the reviewer crashes, we skip
the reviewer. We don't paper over failures with "unverified" flags — the
user's trust in Kelp is worth more than the marginal recall we'd get from
soft-landing them.

This is also why the CLI is deliberately narrower than the hosted app:
CLI runs only deterministic scanners (secrets, RLS static analysis) that
don't need a reviewer at all. The full agent squad lives behind the hosted
app precisely because it needs the reproduction infrastructure.

## Ex ante vs ex post

Some detections (deterministic scanners) are ex ante — the pattern IS the
evidence. A hardcoded `sk_live_...` in the source tree doesn't need to be
"reproduced"; the file's presence + the regex match ARE the reproduction.
These findings ship without a reviewer round trip.

Ex post detections (anything agent-produced) always go through the reviewer.
The dividing line is: **can a deterministic checker see it without running
code?** If yes, ex ante. If no, ex post + reviewer.

## What this costs

- **Latency**: every reviewable finding costs ~1 extra step in the executor.
- **Cost**: reviewer + follow-ups add roughly 30% to the average scan's
  Anthropic bill.
- **Recall**: we drop some findings that a more permissive tool would ship.

We think the trade is worth it. Every finding Kelp shows is a finding an
attacker could actually get.

## Related

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — how the reviewer fits in the scan
  pipeline.
- [`SECURITY-MODEL.md`](SECURITY-MODEL.md) — the wider threat model,
  including what Kelp does NOT verify.
- The internal memory [`autonomous-pentest-engine`](../memory/autonomous-pentest-engine.md)
  captures the reasoning behind this design in more detail.
