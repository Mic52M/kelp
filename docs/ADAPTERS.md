# Backend adapters

Kelp scans one backend today (Supabase). This document is the north star for
extending Kelp to other backends without letting the codebase drift.

## Why the seam matters

Vibe-code tools ship on more than Supabase. Lovable, Bolt, Cursor, v0, and
Replit each let you pick from a small menu of managed backends —
Supabase most commonly, then Firebase, then Convex, then a long tail
(PocketBase, Neon, Xano, Bubble, Airtable). If Kelp is "the security tool for
vibe-coded apps", it has to at some point cover more than one.

But we should NOT rush that. Every adapter is a fresh attack surface to
learn and a new SDK to keep working. So this repo has a plan and a priority
order, and adapters land only when we're ready to commit to maintaining them.

## Today's shape (v0.1)

Kelp is **Supabase-only**. Detection code in `packages/core/src/agent/` and
`packages/worker/src/scan-processor.ts` presupposes Supabase structure:

- `packages/core/src/agent/repo-recon.ts` — `detectSupabaseConfig`,
  `parseRepoSchema` (from `types.ts` + migrations)
- `packages/worker/src/agent/pentest-toolbox.ts` — hits Supabase PostgREST
  and edge-fn URLs
- Findings vocabulary — `verify_jwt`, RLS, `service_role`, edge functions

That's the reality. The docs shouldn't pretend otherwise.

## Where we're going — the `BackendAdapter` interface

Tracked as [issue #45](https://github.com/Mic52M/kelp/issues/45). Rough shape:

```ts
export interface BackendAdapter {
  readonly kind: BackendKind; // "supabase" | "firebase" | ...

  /** Given the connected repo, does this adapter recognize the backend? */
  detect(files: readonly SourceFile[]): DetectionResult | null;

  /** Read schema/config/policies from the repo alone. */
  parseRepoState(files: readonly SourceFile[]): BackendRepoState;

  /** Optional live-read: adapter-specific credentials → live state. */
  readLiveState?(creds: unknown): Promise<BackendLiveState>;

  /** The scanner set applicable to this adapter. */
  scanners: readonly Scanner[];

  /** Adapter-specific active probes (unauth requests, etc.). */
  activeProbes?: readonly ActiveProbe[];
}
```

Once #45 lands, `packages/core/src/adapters/supabase.ts` will contain all the
Supabase-specific logic, and `packages/core/src/agent/` will only talk to
`BackendAdapter`. Anything that today reaches into `detectSupabaseConfig`
directly is refactoring debt against #45.

## Priority order

Not every backend is worth an adapter. In descending order:

### Tier 1 — build now

- **Supabase** ✅ shipped.
- **Firebase** ([issue #38](https://github.com/Mic52M/kelp/issues/38)) — the
  second-most-common vibe-code backend. Different threat surface (Firestore
  security rules instead of RLS, callable functions instead of PostgREST,
  Auth instead of Supabase Auth) — real adapter work, not a config swap.

### Tier 2 — build when a paying customer asks

- **Convex** — small but growing, well-defined security model.
- **Neon** — Postgres-pure escape hatch. Adapter shares a lot with the
  Supabase one (both hit Postgres via a connection string), but auth model is
  different.
- **PocketBase** — self-hosted, single-binary. Interesting community, small
  surface.

### Tier 3 — never

- **Xano, Bubble, Airtable** — the ICP fit is wrong. The app owner is
  typically not the code owner, so there's no fix prompt to hand back and no
  PR flow. If the goal is "vibe-coder fixes their own app", these don't fit.

## The trigger to open the next adapter issue

Not a hunch — a measurable signal. When five or more submissions in a week
to the free-scan surface show `backend_report.primary.type` = "firebase"
(via the PostHog `free_scan.completed` funnel), that's the trigger. Same for
Convex or any other Tier 2.

The point is that adapters are user-demand-driven, not roadmap-driven.

## Contributor's checklist for a new adapter

If you want to add an adapter (and you've read the above), open an issue with
the [`vulnerability_class`](../.github/ISSUE_TEMPLATE/vulnerability_class.yml)
template before code. Once we align on the shape:

1. `packages/core/src/adapters/<kind>.ts` — implements `BackendAdapter`.
2. `packages/core/src/adapters/<kind>.test.ts` — at minimum, one
   `detect` fixture, one `parseRepoState` fixture, one full-scan fixture.
3. Documentation — a section in this file listing what the adapter covers
   and what it doesn't.
4. A demo repo you or Kelp can point at, so the end-to-end works.

No new dependency inside `packages/core` unless it's essential.

## Don't do this

- **Don't import from Supabase-specific modules outside
  `packages/core/src/adapters/supabase.ts` once #45 lands.** Grep should show
  that boundary is respected.
- **Don't ship an adapter that doesn't reach live state**. Repo-only recon is
  fine for a first cut, but an adapter without at least one active probe
  isn't earning its keep.
- **Don't add an adapter for a vibe-code tool with no fix-back-to-source
  loop.** Kelp's value proposition depends on the finding leading to a fix
  the user can paste back into the tool that built the app. Airtable and
  friends break that loop.
