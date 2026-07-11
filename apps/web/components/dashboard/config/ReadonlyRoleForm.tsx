"use client";

import { useActionState } from "react";
import {
  reconnectSupabaseReadonlyAction,
  type ReconnectState,
} from "@/app/dashboard/settings/actions";
import { buttonClasses } from "@/components/Button";
import { SetupGuide } from "@/components/dashboard/SetupGuide";
import { SUPABASE_READONLY_GUIDE } from "@/lib/setup-guides";

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
    <form action={action} className="space-y-5">
      <input type="hidden" name="projectId" value={projectId} />

      <label className="block">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
            Read-only connection string
          </span>
          {hasReadonly && (
            <span
              className="font-mono text-[10px] uppercase tracking-[0.16em]"
              style={{ color: "var(--color-signal)" }}
            >
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
          className="w-full border-b border-[color:var(--color-hair)] bg-transparent px-0 py-2 font-mono text-[13px] text-[color:var(--color-paper-50)] outline-none transition-colors placeholder:text-[color:var(--color-paper-500)] focus:border-[color:var(--color-signal)]"
        />
        <p className="mt-3 max-w-[62ch] text-[12px] leading-[1.7] text-[color:var(--color-paper-400)]">
          Paste the Session pooler URL from Supabase as-is (the one with{" "}
          <code className="bg-[color:var(--color-ink-800)] px-1 font-mono text-[11px] text-[color:var(--color-paper-100)]">
            postgres.&lt;ref&gt;
          </code>{" "}
          — no manual rewrites). Kelp switches to the read-only role at session start.
        </p>
      </label>

      <SetupGuide content={SUPABASE_READONLY_GUIDE} />

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[color:var(--color-hair)] pt-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
          Kelp verifies the URL before storing anything
        </p>
        <button
          type="submit"
          disabled={pending}
          className={buttonClasses("primary", "md", "cta-lift")}
        >
          {pending ? "Verifying…" : "Save read-only credentials"}
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
