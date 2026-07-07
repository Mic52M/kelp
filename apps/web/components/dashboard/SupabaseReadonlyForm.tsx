"use client";

// Issue #5 — per-project read-only Postgres connection string form. Prefer
// this to the Management API PAT for production connects.
//
// UX (post-#3): the <select> is controlled, so switching project surfaces
// per-project state ("stored" chip + swapped placeholder). We never re-render
// the actual connection string (it's a secret) — just the fact that one is
// stored, plus a "Replace" affordance.

import { useMemo, useState } from "react";
import { Button } from "@/components/Button";
import {
  reconnectSupabaseReadonlyAction,
  type ReconnectState,
} from "@/app/dashboard/settings/actions";
import { SetupGuide } from "./SetupGuide";
import { SUPABASE_READONLY_GUIDE } from "@/lib/setup-guides";
import { useActionState } from "react";

export interface SupabaseFormProject {
  id: string;
  name: string;
  hasManagement: boolean;
  hasReadonly: boolean;
}

export function SupabaseReadonlyForm({
  projects,
}: {
  projects: SupabaseFormProject[];
}) {
  const [state, action, pending] = useActionState<ReconnectState, FormData>(
    reconnectSupabaseReadonlyAction,
    null,
  );
  const [selected, setSelected] = useState(projects[0]?.id ?? "");
  const current = useMemo(
    () => projects.find((p) => p.id === selected) ?? projects[0],
    [projects, selected],
  );

  if (projects.length === 0) {
    return <p className="text-sm text-fog-500">Connect a project to enable read-only credentials.</p>;
  }

  return (
    <form action={action} className="space-y-3">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-fog-400">Project</label>
        <div className="relative">
          <select
            name="projectId"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="w-full appearance-none rounded-lg border border-line bg-ink-900 px-3.5 py-2.5 pr-9 text-sm outline-none transition-colors focus:border-aqua-600/60"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.hasReadonly ? "  ·  stored" : ""}
              </option>
            ))}
          </select>
          <svg
            aria-hidden
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fog-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </div>
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <label className="block text-xs font-medium text-fog-400">
            Read-only connection string
          </label>
          {current?.hasReadonly && (
            <span className="rounded-full bg-aqua-500/10 px-2 py-0.5 text-[10.5px] font-medium text-aqua-300">
              Stored
            </span>
          )}
        </div>
        <input
          name="connectionString"
          type="password"
          placeholder={
            current?.hasReadonly
              ? "•••••• (stored — paste a new one to replace)"
              : "postgres://postgres.<ref>:…@aws-0-<region>.pooler.supabase.com:5432/postgres"
          }
          className="w-full rounded-lg border border-line bg-ink-900 px-3.5 py-2.5 text-sm font-mono outline-none transition-colors focus:border-aqua-600/60"
        />
        <p className="mt-1.5 text-[11px] text-fog-500">
          Paste the Session pooler URL from Supabase as-is (the one with
          <code className="mx-1 rounded bg-ink-800 px-1 text-fog-300">postgres.&lt;ref&gt;</code>
          — no manual rewrites). Kelp switches to the read-only role at session
          start.
        </p>
        <SetupGuide content={SUPABASE_READONLY_GUIDE} />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Verifying…" : "Save read-only credentials"}
        </Button>
        {state?.message && (
          <p className={`text-sm ${state.ok ? "text-aqua-400" : "text-crit"}`}>{state.message}</p>
        )}
      </div>
    </form>
  );
}
