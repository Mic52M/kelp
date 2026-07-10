"use client";

import { useState } from "react";
import { ReadonlyRoleForm } from "./ReadonlyRoleForm";
import { ManagementTokenForm } from "./ManagementTokenForm";
import { ChevronDownIcon } from "./icons";

export interface AdvancedGroupProps {
  projectId: string;
  /** True when the project has a Supabase ref set (auto-detected or manual).
   *  Advanced credentials only apply once we know which Supabase project the
   *  role/token belongs to. */
  supabaseLinked: boolean;
  hasReadonly: boolean;
  hasManagement: boolean;
}

/**
 * Optional deeper-integration credentials. Collapsed by default because
 * 90% of users (Lovable Cloud / Bolt / v0 auto-detect) never need to touch
 * these. Uses the same visual vocabulary as the required cards above.
 */
export function AdvancedGroup(props: AdvancedGroupProps) {
  const [open, setOpen] = useState(false);
  const anyStored = props.hasReadonly || props.hasManagement;

  return (
    <div className="rounded-2xl border border-line/60 bg-ink-900/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left"
        aria-expanded={open}
      >
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-fog-500">
            Advanced
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="text-[14.5px] font-semibold text-fog-100">
              Deeper database access
            </span>
            {anyStored && (
              <span className="rounded-full bg-fog-500/12 px-2 py-0.5 text-[10.5px] font-medium text-fog-300">
                Configured
              </span>
            )}
          </div>
          <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-fog-400">
            Optional. Give Kelp a live database view for a deeper scan. You don't need this
            on Lovable Cloud or if Kelp already auto-detected your backend above.
          </p>
        </div>
        <ChevronDownIcon
          className={`h-4 w-4 shrink-0 text-fog-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="space-y-8 border-t border-line/60 px-6 py-6">
          {props.supabaseLinked ? (
            <>
              <SubSection
                label="Read-only Postgres role"
                description="Preferred. A least-privilege role Kelp uses to read your schema + RLS state directly, without touching customer data."
              >
                <ReadonlyRoleForm
                  projectId={props.projectId}
                  hasReadonly={props.hasReadonly}
                />
              </SubSection>
              <div className="h-px w-full bg-line/40" />
              <SubSection
                label="Supabase Management token"
                description="Legacy fallback. Account-level PAT — grants broader access than the read-only role. Prefer the role above."
              >
                <ManagementTokenForm
                  projectId={props.projectId}
                  hasManagement={props.hasManagement}
                />
              </SubSection>
            </>
          ) : (
            <p className="text-[13px] text-fog-500">
              Link a Supabase project first (see Step 1 above) to enable deeper database
              credentials.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SubSection({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-fog-500">
        {label}
      </div>
      <p className="mb-4 mt-1 max-w-xl text-[12.5px] leading-relaxed text-fog-400">
        {description}
      </p>
      {children}
    </div>
  );
}
