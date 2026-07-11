"use client";

import { useActionState } from "react";
import {
  reconnectSupabaseAction,
  type ReconnectState,
} from "@/app/dashboard/settings/actions";
import { buttonClasses } from "@/components/Button";
import { SetupGuide } from "@/components/dashboard/SetupGuide";
import { SUPABASE_MGMT_TOKEN_GUIDE } from "@/lib/setup-guides";

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
    <form action={action} className="space-y-5">
      <input type="hidden" name="projectId" value={projectId} />

      <label className="block">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
            Management API token
          </span>
          {hasManagement && (
            <span
              className="font-mono text-[10px] uppercase tracking-[0.16em]"
              style={{ color: "var(--color-signal)" }}
            >
              Stored ✓
            </span>
          )}
        </div>
        <input
          name="token"
          type="password"
          autoComplete="off"
          placeholder={
            hasManagement ? "•••••• (stored — paste a new one to replace)" : "sbp_…"
          }
          className="w-full border-b border-[color:var(--color-hair)] bg-transparent px-0 py-2 font-mono text-[13px] text-[color:var(--color-paper-50)] outline-none transition-colors placeholder:text-[color:var(--color-paper-500)] focus:border-[color:var(--color-signal)]"
        />
        <p className="mt-3 max-w-[62ch] text-[12px] leading-[1.7] text-[color:var(--color-paper-400)]">
          Account-level Supabase token. Grants broader access than the read-only role above —
          rotate it in Supabase if you suspect leakage.
        </p>
      </label>

      <SetupGuide content={SUPABASE_MGMT_TOKEN_GUIDE} />

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[color:var(--color-hair)] pt-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
          Leave blank to keep the stored token
        </p>
        <button
          type="submit"
          disabled={pending}
          className={buttonClasses("primary", "md", "cta-lift")}
        >
          {pending ? "Saving…" : "Save token"}
        </button>
      </div>

      {state?.message && (
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
  );
}
