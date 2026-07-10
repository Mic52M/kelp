"use client";

import { useState } from "react";
import { useActionState } from "react";
import { configureActivePentestAction } from "@/app/dashboard/settings/actions";
import { CardShell } from "./CardShell";
import { DatabaseIcon, ChevronDownIcon } from "./icons";

export interface BackendCardProps {
  projectId: string;
  projectName: string;
  supabaseProjectRef: string | null;
  hasSupabaseAnonKey: boolean;
  hasSupabaseManagement: boolean;
  /**
   * True when Kelp's analyzer identified Supabase but couldn't extract the
   * URL/anon key from the repo (backend-only repos, or apps that inject
   * config via env vars at build time). Changes the copy from "auto-detect
   * works, ignore this" to "we can't read your config — please paste it".
   */
  supabaseDetectedButNotExtracted?: boolean;
}

/**
 * Step 1 — Backend. Two visual states:
 *
 *  A. Auto-detected (ref + anon key both present): shows the detected values,
 *     collapsed. The user only expands if they want to override.
 *
 *  B. Missing (backend-only repos, non-Lovable frontends): shows an explicit
 *     inline form for ref + anon key up front, plus an inline explainer of
 *     where to find each. This is the state that unblocks the kelp-corpus /
 *     managed-Supabase-without-client-repo case.
 *
 * Save is scoped to just these two credentials so users can complete this
 * step independently of test accounts.
 */
export function BackendCard(props: BackendCardProps) {
  const [state, action, pending] = useActionState<
    { ok: boolean; message: string } | null,
    FormData
  >(configureActivePentestAction, null);

  // "Done" needs BOTH ref + anon key. Ref alone won't let Kelp probe PostgREST.
  const done = Boolean(props.supabaseProjectRef) && props.hasSupabaseAnonKey;
  const partial = Boolean(props.supabaseProjectRef) !== props.hasSupabaseAnonKey;
  const [expanded, setExpanded] = useState(!done);

  const status = done ? "done" : "needed";

  return (
    <CardShell
      id="backend"
      step={1}
      icon={<DatabaseIcon />}
      title="Connect the backend"
      description={
        done ? (
          <>Kelp will scan your Supabase project — everything looks good here.</>
        ) : partial ? (
          <>
            One field is still missing before Kelp can reach your Supabase — fill it below
            to unblock the pen test.
          </>
        ) : props.supabaseDetectedButNotExtracted ? (
          <>
            <b className="text-fog-200">Kelp identified Supabase</b> in your repo but
            couldn't extract the project URL or public anon key — your app injects them
            via env vars at build time, not committed to the repo. Paste the two values
            below to unblock the pen test.
          </>
        ) : (
          <>
            Kelp reads the backend automatically from your connected repo. If your repo
            doesn't ship a Supabase client (backend-only repos, custom stacks) paste the
            two values below — takes 30 seconds.
          </>
        )
      }
      status={status}
      statusLabel={done ? "Ready" : partial ? "Almost" : "Needed"}
      headerRight={
        done ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg border border-line/60 px-2.5 py-1 text-[11.5px] text-fog-400 transition-colors hover:border-line hover:text-fog-200"
          >
            {expanded ? "Hide" : "Override"}
            <ChevronDownIcon
              className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </button>
        ) : undefined
      }
    >
      {done && !expanded ? (
        <ReadOnlySummary
          supabaseProjectRef={props.supabaseProjectRef}
        />
      ) : (
        <form action={action} className="space-y-4">
          <input type="hidden" name="projectId" value={props.projectId} />

          <FieldBlock
            label="Supabase project ref"
            hint={
              <>
                The 20-character subdomain from your Supabase URL —{" "}
                <code className="rounded bg-ink-800/80 px-1 py-0.5 font-mono text-[11.5px] text-fog-300">
                  https://<b>REF</b>.supabase.co
                </code>
                . Find it under{" "}
                <span className="text-fog-300">Project Settings → General</span> in Supabase.
              </>
            }
            defaultBadge={props.supabaseProjectRef ? "Detected" : null}
          >
            <input
              name="supabaseProjectRef"
              type="text"
              autoComplete="off"
              placeholder={
                props.supabaseProjectRef
                  ? `${props.supabaseProjectRef} (paste to override)`
                  : "e.g. abcdefghijklmnopqrst"
              }
              className="w-full rounded-lg border border-line bg-ink-950/60 px-3.5 py-2.5 text-sm font-mono text-fog-100 outline-none transition-colors placeholder:text-fog-600 focus:border-aqua-600/60"
            />
          </FieldBlock>

          <FieldBlock
            label="Supabase anon key"
            hint={
              <>
                This is <b>public</b> — it ships in your app's browser bundle. In Supabase, find it
                under <span className="text-fog-300">Project Settings → API → Project API keys</span>{" "}
                (the one labeled <code className="mx-0.5 rounded bg-ink-800/80 px-1 font-mono text-[11.5px] text-fog-300">anon</code> /{" "}
                <code className="mx-0.5 rounded bg-ink-800/80 px-1 font-mono text-[11.5px] text-fog-300">public</code>).
              </>
            }
            defaultBadge={
              props.hasSupabaseAnonKey
                ? "Detected"
                : props.hasSupabaseManagement
                  ? "Auto-fetch via PAT"
                  : null
            }
          >
            <input
              name="supabaseAnonKey"
              type="text"
              autoComplete="off"
              placeholder={
                props.hasSupabaseAnonKey
                  ? "•••••• (detected — paste to override)"
                  : props.hasSupabaseManagement
                    ? "auto-fetched via Management PAT — paste to override"
                    : "eyJhbGciOi… or sb_publishable_…"
              }
              className="w-full rounded-lg border border-line bg-ink-950/60 px-3.5 py-2.5 text-sm font-mono text-fog-100 outline-none transition-colors placeholder:text-fog-600 focus:border-aqua-600/60"
            />
          </FieldBlock>

          {/* Save row */}
          <div className="flex items-center justify-between pt-2">
            <p className="text-[12px] text-fog-500">
              Leave a field blank to keep the current value.
            </p>
            <button
              type="submit"
              disabled={pending}
              className="shrink-0 whitespace-nowrap rounded-lg bg-gradient-to-r from-aqua-400 to-aqua-600 px-4 py-2 text-sm font-medium text-ink-950 shadow-sm shadow-aqua-500/10 transition-all disabled:opacity-40"
            >
              {pending ? "Saving…" : "Save backend"}
            </button>
          </div>

          {state && (
            <p
              className={`rounded-lg border px-3 py-2 text-[12.5px] ${
                state.ok
                  ? "border-aqua-600/30 bg-aqua-500/[0.06] text-aqua-300"
                  : "border-crit/30 bg-crit/[0.06] text-crit"
              }`}
            >
              {state.message}
            </p>
          )}
        </form>
      )}
    </CardShell>
  );
}

function ReadOnlySummary({ supabaseProjectRef }: { supabaseProjectRef: string | null }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      <div>
        <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-fog-500">
          Project ref
        </dt>
        <dd className="mt-1 font-mono text-sm text-fog-200">{supabaseProjectRef ?? "—"}</dd>
      </div>
      <div>
        <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-fog-500">
          Anon key
        </dt>
        <dd className="mt-1 font-mono text-sm text-fog-400">•••••• (stored)</dd>
      </div>
    </dl>
  );
}

function FieldBlock({
  label,
  hint,
  defaultBadge,
  children,
}: {
  label: string;
  hint: React.ReactNode;
  defaultBadge: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[12px] font-medium text-fog-300">{label}</span>
        {defaultBadge && (
          <span className="rounded-full bg-aqua-500/10 px-2 py-0.5 text-[10.5px] font-medium text-aqua-300">
            {defaultBadge} ✓
          </span>
        )}
      </div>
      {children}
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-fog-500">{hint}</p>
    </label>
  );
}
