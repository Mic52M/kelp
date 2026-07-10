"use client";

import { useActionState } from "react";
import {
  reconnectSupabaseAction,
  type ReconnectState,
} from "@/app/dashboard/settings/actions";
import { SetupGuide } from "@/components/dashboard/SetupGuide";
import { SUPABASE_MGMT_TOKEN_GUIDE } from "@/lib/setup-guides";

/**
 * Legacy Management API token form — kept as a fallback when the customer
 * can't create the read-only role. Same visual language as ReadonlyRoleForm.
 * No internal project select (Configuration is already scoped).
 */
export function ManagementTokenForm({
  projectId,
  hasManagement,
}: {
  projectId: string;
  hasManagement: boolean;
}) {
  const [state, action, pending] = useActionState<ReconnectState, FormData>(
    reconnectSupabaseAction,
    null,
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="projectId" value={projectId} />

      <label className="block">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[12px] font-medium text-fog-300">Management API token</span>
          {hasManagement && (
            <span className="rounded-full bg-aqua-500/10 px-2 py-0.5 text-[10.5px] font-medium text-aqua-300">
              Stored ✓
            </span>
          )}
        </div>
        <input
          name="token"
          type="password"
          autoComplete="off"
          placeholder={
            hasManagement
              ? "•••••• (stored — paste a new one to replace)"
              : "sbp_…"
          }
          className="w-full rounded-lg border border-line bg-ink-950/60 px-3.5 py-2.5 text-sm font-mono text-fog-100 outline-none transition-colors placeholder:text-fog-600 focus:border-aqua-600/60"
        />
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-fog-500">
          Account-level Supabase token. Grants broader access than the read-only role above —
          rotate it in Supabase if you suspect leakage.
        </p>
      </label>

      <SetupGuide content={SUPABASE_MGMT_TOKEN_GUIDE} />

      <div className="flex items-center justify-between pt-1">
        <p className="text-[12px] text-fog-500">Leave blank to keep the stored token.</p>
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 whitespace-nowrap rounded-lg bg-gradient-to-r from-aqua-400 to-aqua-600 px-4 py-2 text-sm font-medium text-ink-950 shadow-sm shadow-aqua-500/10 transition-all disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save token"}
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
