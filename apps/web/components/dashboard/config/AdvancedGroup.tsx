"use client";

import { useState } from "react";
import { ReadonlyRoleForm } from "./ReadonlyRoleForm";
import { ManagementTokenForm } from "./ManagementTokenForm";
import { ChevronDownIcon } from "./icons";

export interface AdvancedGroupProps {
  projectId: string;
  supabaseLinked: boolean;
  hasReadonly: boolean;
  hasManagement: boolean;
}

export function AdvancedGroup(props: AdvancedGroupProps) {
  const [open, setOpen] = useState(false);
  const anyStored = props.hasReadonly || props.hasManagement;

  return (
    <div className="border border-[color:var(--color-hair)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-4 px-6 py-5 text-left transition-colors hover:bg-[color:var(--color-ink-850)]"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
            § Advanced · optional
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="font-display text-[20px] leading-[1.15] text-[color:var(--color-paper-50)]">
              Deeper database access
            </span>
            {anyStored && (
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-paper-400)]">
                Configured
              </span>
            )}
          </div>
          <p className="mt-3 max-w-xl text-[13px] leading-[1.65] text-[color:var(--color-paper-400)]">
            Optional. Give Kelp a live database view for a deeper scan. You don't need this on
            managed Supabase or if Kelp already auto-detected your backend above.
          </p>
        </div>
        <ChevronDownIcon
          className={`mt-2 h-4 w-4 shrink-0 text-[color:var(--color-paper-400)] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="space-y-10 border-t border-[color:var(--color-hair)] px-6 py-8">
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
              <div className="h-px w-full bg-[color:var(--color-hair)]" />
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
            <p className="font-mono text-[12px] text-[color:var(--color-paper-500)]">
              Link a Supabase project first (see Step 01 above) to enable deeper database credentials.
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
      <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
        § {label}
      </div>
      <p className="mb-5 mt-3 max-w-xl text-[13px] leading-[1.65] text-[color:var(--color-paper-400)]">
        {description}
      </p>
      {children}
    </div>
  );
}
