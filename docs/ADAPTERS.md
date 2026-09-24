# Backend adapters

Kelp scans two backends today (Supabase and Firebase) behind an explicit
`BackendAdapter` seam. This document is the model for adding more without
letting the codebase drift.

## Why the seam matters

Vibe-code tools ship on more than one backend. They each let you pick from a
small menu of managed backends: Supabase most commonly, then Firebase, then
Convex, then a long tail (PocketBase, Neon, Xano, Bubble, Airtable). A security
tool for vibe-coded apps has to cover more than one.

But we do not rush it. Every adapter is a fresh attack surface to learn and a
new SDK to keep working, so the repo has a priority order and adapters land only
when we are ready to commit to maintaining them.

## Today's shape

The `BackendAdapter` interface ([issue #45](https://github.com/Mic52M/kelp/issues/45))
has landed, and two adapters implement it:

- `packages/core/src/adapters/supabase.ts` — config + schema from
  `supabase/migrations` and `types.ts`, edge functions, RLS.
- `packages/core/src/adapters/firebase.ts` — detection from `firebase.json` /
  `.firebaserc` / `*.rules` / a firebase SDK import, collections and allow
  rules from `firestore.rules`, Cloud Functions under `functions/`.

The registry (`packages/core/src/adapters/registry.ts`) registers Supabase
first, then Firebase, and picks the first adapter that recognizes a repo, so a
Supabase repo still resolves to Supabase. The live-probe pentest path in
`apps/worker/` is still Supabase-shaped; Firebase is static-rules-only for now,
with live probing over the Firebase Admin SDK as the follow-up.

## The `BackendAdapter` interface

The four operations every backend detection needs:

```ts
export interface BackendAdapter {
  readonly type: string; // "supabase" | "firebase" | ...

  /** Does this repo look like it uses this backend? Null when it doesn't. */
  detectFromRepo(files: readonly SourceFile[]): BackendMeta | null;

  /** Recover the table/collection graph from the repo's source. */
  parseSchema(files: readonly SourceFile[]): TableIntel[];

  /** Discover the deployable surface (edge / cloud functions). */
  discoverFunctions(files: readonly SourceFile[]): DiscoveredEdgeFunction[];

  /** Static analysis of the app's auth model (cookie vs bearer, ...). */
  analyzeAuth(files: readonly SourceFile[]): AuthModel;
}
```

All four are mandatory; the registry rejects a partial adapter at registration
time, not at first scan. Each adapter's backend-specific logic stays inside its
own module (`adapters/supabase.ts`, `adapters/firebase.ts`); anything that
reaches into `detectSupabaseConfig` directly from outside an adapter is
refactoring debt against the seam.

The static rule findings themselves live in `packages/core/src/scanners/`
(for example `rls-sql.ts`, `storage-acl.ts`, `firebase-rules.ts`,
`nextjs-routes.ts`) and are wired into the CLI, the MCP server, and the
landing-page free scan.

## Priority order

Not every backend is worth an adapter. In descending order:

### Tier 1 — build now

- **Supabase** ✅ shipped.
- **Firebase** ✅ shipped ([issue #38](https://github.com/Mic52M/kelp/issues/38),
  CLI v0.14.0). Static Firestore + Storage security-rules analysis
  (`firebase-rules.ts`) plus the `firebaseAdapter`. A different threat surface
  from Supabase: security rules instead of RLS, callable functions instead of
  PostgREST, Firebase Auth instead of Supabase Auth. Live probing over the
  Firebase Admin SDK is the remaining follow-up.

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

Not a hunch, a measurable signal. When five or more submissions in a week to
the free-scan surface show `backend_report.primary.type` = "convex" (via the
PostHog `free_scan.completed` funnel), that is the trigger to open the Convex
adapter. Same for any other Tier 2. Firebase repos are already scanned
statically, so that signal now feeds prioritizing live Firebase probing rather
than opening the adapter.

The point is that adapters are user-demand-driven, not roadmap-driven.

## Contributor's checklist for a new adapter

If you want to add an adapter (and you've read the above), open an issue with
the [`vulnerability_class`](../.github/ISSUE_TEMPLATE/vulnerability_class.yml)
template before code. Once we align on the shape:

1. `packages/core/src/adapters/<kind>.ts` — implements `BackendAdapter`
   (`detectFromRepo`, `parseSchema`, `discoverFunctions`, `analyzeAuth`), and
   registers in `adapters/registry.ts`.
2. `packages/core/src/adapters/<kind>.test.ts` — at minimum a `detectFromRepo`
   fixture, a `parseSchema` fixture, and a registry-integration fixture.
3. The detection payload as a scanner in `packages/core/src/scanners/`, with
   VULN/CONTROL test pairs, wired into the CLI, the MCP server, and the free
   scan (Firebase did this with `firebase-rules.ts`).
4. Documentation — a section in this file listing what the adapter covers
   and what it doesn't.
5. A demo repo you or Kelp can point at, so the end-to-end works.

No new dependency inside `packages/core` unless it's essential.

## Don't do this

- **Don't import from Supabase-specific modules outside
  `packages/core/src/adapters/supabase.ts`.** Grep should show that boundary
  is respected now that the seam has landed.
- **Static repo-only analysis is a valid first cut**, but live probing is the
  goal. Firebase shipped static-rules-only on purpose; the follow-up is live
  probing over the Firebase Admin SDK. An adapter that will never reach live
  state (no path to an active probe) isn't earning its keep long term.
- **Don't add an adapter for a vibe-code tool with no fix-back-to-source
  loop.** Kelp's value proposition depends on the finding leading to a fix
  the user can paste back into the tool that built the app. Airtable and
  friends break that loop.
