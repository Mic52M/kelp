"use client";

import { useActionState } from "react";
import {
  reconnectSupabaseReadonlyAction,
  type ReconnectState,
} from "@/app/dashboard/settings/actions";
import { SetupGuide } from "@/components/dashboard/SetupGuide";
import { SUPABASE_READONLY_GUIDE } from "@/lib/setup-guides";

/**
 * Least-privilege Postgres role form, scoped to the currently-selected
 * project (no inner project select — Configuration is already scoped via the
 * top switcher). Visual language matches BackendCard / TestAccountsCard.
 */
export function ReadonlyRoleForm({
  projectId,
  hasReadonly,
}: {
  projectId: string;
  hasReadonly: boolean;
}) {
  const [state, action, pending] = useActionState<ReconnectState, FormData>(
    reconnectSupabaseReadonlyAction,
    null,
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="projectId" value={projectId} />

      <label className="block">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[12px] font-medium text-fog-300">Read-only connection string</span>
          {hasReadonly && (
            <span className="rounded-full bg-aqua-500/10 px-2 py-0.5 text-[10.5px] font-medium text-aqua-300">
              Stored ✓
            </span>
          )}
        </div>
        <input
          name="connectionString"
          type="password"
          autoComplete="off"
          placeholder={
            hasReadonly
              ? "•••••• (stored — paste a new one to replace)"
              : "postgres://postgres.<ref>:…@aws-0-<region>.pooler.supabase.com:5432/postgres"
          }
          className="w-full rounded-lg border border-line bg-ink-950/60 px-3.5 py-2.5 text-sm font-mono text-fog-100 outline-none transition-colors placeholder:text-fog-600 focus:border-aqua-600/60"
        />
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-fog-500">
          Paste the Session pooler URL from Supabase as-is (the one with{" "}
          <code className="rounded bg-ink-800/80 px-1 font-mono text-[11.5px] text-fog-300">
            postgres.&lt;ref&gt;
          </code>{" "}
          — no manual rewrites). Kelp switches to the read-only role at session start.
        </p>
      </label>

      <SetupGuide content={SUPABASE_READONLY_GUIDE} />

      <div className="flex items-center justify-between pt-1">
        <p className="text-[12px] text-fog-500">
          Kelp verifies the URL before storing anything.
        </p>
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 whitespace-nowrap rounded-lg bg-gradient-to-r from-aqua-400 to-aqua-600 px-4 py-2 text-sm font-medium text-ink-950 shadow-sm shadow-aqua-500/10 transition-all disabled:opacity-40"
        >
          {pending ? "Verifying…" : "Save read-only credentials"}
        </button>
      </div>

      {state?.message && (
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
  );
}
