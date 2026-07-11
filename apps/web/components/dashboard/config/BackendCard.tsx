"use client";

import { useState } from "react";
import { useActionState } from "react";
import { configureActivePentestAction } from "@/app/dashboard/settings/actions";
import { buttonClasses } from "@/components/Button";
import { CardShell } from "./CardShell";
import { DatabaseIcon, ChevronDownIcon } from "./icons";

export interface BackendCardProps {
  projectId: string;
  projectName: string;
  supabaseProjectRef: string | null;
  hasSupabaseAnonKey: boolean;
  hasSupabaseManagement: boolean;
  supabaseDetectedButNotExtracted?: boolean;
}

export function BackendCard(props: BackendCardProps) {
  const [state, action, pending] = useActionState<
    { ok: boolean; message: string } | null,
    FormData
  >(configureActivePentestAction, null);

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
            One field is still missing before Kelp can reach your Supabase — fill it below to
            unblock the pen test.
          </>
        ) : props.supabaseDetectedButNotExtracted ? (
          <>
            <span className="text-[color:var(--color-paper-100)]">Kelp identified Supabase</span> in
            your repo but couldn't extract the project URL or public anon key — your app injects
            them via env vars at build time. Paste the two values below to unblock the pen test.
          </>
        ) : (
          <>
            Kelp reads the backend automatically from your connected repo. If your repo doesn't
            ship a Supabase client (backend-only repos, custom stacks) paste the two values below —
            takes 30 seconds.
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
            className="inline-flex items-center gap-1.5 border border-[color:var(--color-hair-strong)] px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-400)] transition-colors hover:border-[color:var(--color-paper-400)] hover:text-[color:var(--color-paper-50)]"
          >
            {expanded ? "Hide" : "Override"}
            <ChevronDownIcon
              className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </button>
        ) : undefined
      }
    >
      {done && !expanded ? (
        <ReadOnlySummary supabaseProjectRef={props.supabaseProjectRef} />
      ) : (
        <form action={action} className="space-y-6">
          <input type="hidden" name="projectId" value={props.projectId} />

          <FieldBlock
            label="Supabase project ref"
            hint={
              <>
                The 20-character subdomain from your Supabase URL —{" "}
                <code className="bg-[color:var(--color-ink-800)] px-1 py-0.5 font-mono text-[11.5px] text-[color:var(--color-paper-100)]">
                  https://<b className="text-[color:var(--color-signal)]">REF</b>.supabase.co
                </code>
                . Find it under{" "}
                <span className="text-[color:var(--color-paper-100)]">
                  Project Settings → General
                </span>{" "}
                in Supabase.
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
              className="w-full border-b border-[color:var(--color-hair)] bg-transparent px-0 py-2 font-mono text-[13px] text-[color:var(--color-paper-50)] outline-none transition-colors placeholder:text-[color:var(--color-paper-500)] focus:border-[color:var(--color-signal)]"
            />
          </FieldBlock>

          <FieldBlock
            label="Supabase anon key"
            hint={
              <>
                This is <span className="text-[color:var(--color-paper-100)]">public</span> — it
                ships in your app's browser bundle. In Supabase, under{" "}
                <span className="text-[color:var(--color-paper-100)]">
                  Project Settings → API → Project API keys
                </span>{" "}
                (the one labeled{" "}
                <code className="bg-[color:var(--color-ink-800)] px-1 font-mono text-[11.5px] text-[color:var(--color-paper-100)]">
                  anon
                </code>{" "}
                /{" "}
                <code className="bg-[color:var(--color-ink-800)] px-1 font-mono text-[11.5px] text-[color:var(--color-paper-100)]">
                  public
                </code>
                ).
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
              className="w-full border-b border-[color:var(--color-hair)] bg-transparent px-0 py-2 font-mono text-[13px] text-[color:var(--color-paper-50)] outline-none transition-colors placeholder:text-[color:var(--color-paper-500)] focus:border-[color:var(--color-signal)]"
            />
          </FieldBlock>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[color:var(--color-hair)] pt-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
              Leave a field blank to keep the current value
            </p>
            <button
              type="submit"
              disabled={pending}
              className={buttonClasses("primary", "md", "cta-lift")}
            >
              {pending ? "Saving…" : "Save backend"}
            </button>
          </div>

          {state && (
            <p
              className="border-l px-4 py-2.5 font-mono text-[12px] leading-relaxed"
              style={{
                borderColor: state.ok ? "var(--color-signal)" : "var(--color-sev-crit)",
                color: state.ok ? "var(--color-signal)" : "var(--color-sev-crit)",
              }}
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
    <dl className="grid gap-6 sm:grid-cols-2">
      <div>
        <dt className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
          Project ref
        </dt>
        <dd className="mt-2 font-mono text-[13px] text-[color:var(--color-paper-50)]">
          {supabaseProjectRef ?? "—"}
        </dd>
      </div>
      <div>
        <dt className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
          Anon key
        </dt>
        <dd className="mt-2 font-mono text-[13px] text-[color:var(--color-paper-400)]">
          •••••• stored
        </dd>
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
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
          {label}
        </span>
        {defaultBadge && (
          <span
            className="font-mono text-[10px] uppercase tracking-[0.16em]"
            style={{ color: "var(--color-signal)" }}
          >
            {defaultBadge} ✓
          </span>
        )}
      </div>
      {children}
      <p className="mt-3 max-w-[62ch] text-[12px] leading-[1.7] text-[color:var(--color-paper-400)]">
        {hint}
      </p>
    </label>
  );
}
