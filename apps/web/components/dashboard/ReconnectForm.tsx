"use client";

import { useActionState } from "react";
import { Button } from "@/components/Button";
import { reconnectSupabaseAction, type ReconnectState } from "@/app/dashboard/settings/actions";

export function ReconnectForm({
  projects,
}: {
  projects: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<ReconnectState, FormData>(
    reconnectSupabaseAction,
    null,
  );

  if (projects.length === 0) {
    return <p className="text-sm text-fog-500">No projects connected yet.</p>;
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
          New Supabase Management API token
        </label>
        <input
          name="token"
          type="password"
          placeholder="sbp_…"
          className="w-full rounded-lg border border-line bg-ink-900 px-3.5 py-2.5 text-sm outline-none focus:border-aqua-600/60"
        />
      </div>

      {state && (
        <p
          className={`rounded-lg border px-3 py-2 text-xs ${
            state.ok
              ? "border-aqua-600/40 bg-aqua-500/10 text-aqua-400"
              : "border-[color:var(--color-crit)]/30 bg-[color:var(--color-crit)]/10 text-[color:var(--color-crit)]"
          }`}
        >
          {state.message}
        </p>
      )}

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Reconnecting…" : "Reconnect & re-scan"}
      </Button>
    </form>
  );
}
