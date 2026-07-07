"use client";

// Issue #5 — the per-project read-only Postgres connection string form.
// Prefer this to the Management API PAT for production connects: only
// pg_catalog + information_schema read grants, no application data reach.

import { useActionState } from "react";
import { Button } from "@/components/Button";
import {
  reconnectSupabaseReadonlyAction,
  type ReconnectState,
} from "@/app/dashboard/settings/actions";
import { SetupGuide } from "./SetupGuide";
import { SUPABASE_READONLY_GUIDE } from "@/lib/setup-guides";

export function SupabaseReadonlyForm({
  projects,
}: {
  projects: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<ReconnectState, FormData>(
    reconnectSupabaseReadonlyAction,
    null,
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
            defaultValue={projects[0]?.id}
            className="w-full appearance-none rounded-lg border border-line bg-ink-900 px-3.5 py-2.5 pr-9 text-sm outline-none transition-colors focus:border-aqua-600/60"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
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
        <label className="mb-1.5 block text-xs font-medium text-fog-400">
          Read-only connection string
        </label>
        <input
          name="connectionString"
          type="password"
          placeholder="postgres://kelp_readonly:…@db.<ref>.supabase.co:6543/postgres"
          className="w-full rounded-lg border border-line bg-ink-900 px-3.5 py-2.5 text-sm font-mono outline-none transition-colors focus:border-aqua-600/60"
        />
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
