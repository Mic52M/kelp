"use client";

import { useMemo, useState, useActionState } from "react";
import { Button } from "@/components/Button";
import { reconnectSupabaseAction, type ReconnectState } from "@/app/dashboard/settings/actions";
import { SetupGuide } from "./SetupGuide";
import { SUPABASE_MGMT_TOKEN_GUIDE } from "@/lib/setup-guides";
import type { SupabaseFormProject } from "./SupabaseReadonlyForm";

export function ReconnectForm({
  projects,
}: {
  projects: SupabaseFormProject[];
}) {
  const [state, action, pending] = useActionState<ReconnectState, FormData>(
    reconnectSupabaseAction,
    null,
  );
  const [selected, setSelected] = useState(projects[0]?.id ?? "");
  const current = useMemo(
    () => projects.find((p) => p.id === selected) ?? projects[0],
    [projects, selected],
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
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="w-full appearance-none rounded-lg border border-line bg-ink-900 px-3.5 py-2.5 pr-9 text-sm outline-none transition-colors focus:border-aqua-600/60"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.hasManagement ? "  ·  stored" : ""}
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
            Supabase Management API token
          </label>
          {current?.hasManagement && (
            <span className="rounded-full bg-aqua-500/10 px-2 py-0.5 text-[10.5px] font-medium text-aqua-300">
              Stored
            </span>
          )}
        </div>
        <input
          name="token"
          type="password"
          placeholder={
            current?.hasManagement
              ? "•••••• (stored — paste a new one to replace)"
              : "sbp_…"
          }
          className="w-full rounded-lg border border-line bg-ink-900 px-3.5 py-2.5 text-sm outline-none focus:border-aqua-600/60"
        />
        <SetupGuide content={SUPABASE_MGMT_TOKEN_GUIDE} />
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
        {pending ? "Saving…" : "Save token"}
      </Button>
    </form>
  );
}
