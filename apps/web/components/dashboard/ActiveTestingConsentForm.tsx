"use client";

// Issue #24 — accept/revoke UI for v2 active-testing consent per project.
//
// The component is deliberately dense: it shows the verbatim v2 copy inline
// (so the accept click is fully informed) plus current status per project. If
// a project has no consent row, the Accept button is enabled; if it has an
// active row, the Revoke button is enabled instead.

import { useActionState, useState } from "react";
import { Button } from "@/components/Button";
import {
  acceptV2ConsentAction,
  revokeV2ConsentAction,
  type ConsentActionState,
} from "@/app/dashboard/settings/actions";

export interface ProjectConsent {
  projectId: string;
  projectName: string;
  status: "granted" | "revoked" | "none";
  version: string | null;
  consentedAt: string | null;
}

export function ActiveTestingConsentForm({
  consents,
  copy,
  version,
}: {
  consents: ProjectConsent[];
  copy: string;
  version: string;
}) {
  const [selected, setSelected] = useState(consents[0]?.projectId ?? "");
  const [accept, acceptAction, acceptPending] = useActionState<ConsentActionState, FormData>(
    acceptV2ConsentAction,
    null,
  );
  const [revoke, revokeAction, revokePending] = useActionState<ConsentActionState, FormData>(
    revokeV2ConsentAction,
    null,
  );

  if (consents.length === 0) {
    return <p className="text-sm text-fog-500">Connect a project to enable active-testing consent.</p>;
  }

  const current = consents.find((c) => c.projectId === selected) ?? consents[0]!;
  const state = accept?.message ? accept : revoke;

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-fog-400">Project</label>
        <div className="relative">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="w-full appearance-none rounded-lg border border-line bg-ink-900 px-3.5 py-2.5 pr-9 text-sm outline-none transition-colors focus:border-aqua-600/60"
          >
            {consents.map((c) => (
              <option key={c.projectId} value={c.projectId}>
                {c.projectName}
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

      <div className="rounded-xl border border-line/70 bg-ink-900/40 p-4">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-medium uppercase tracking-[0.14em] text-fog-500">
            Consent text — version {version}
          </span>
          <ConsentBadge status={current.status} version={current.version} />
        </div>
        <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-fog-300">
          {copy}
        </pre>
      </div>

      {current.status === "granted" ? (
        <form action={revokeAction}>
          <input type="hidden" name="projectId" value={current.projectId} />
          <Button type="submit" variant="secondary" disabled={revokePending}>
            {revokePending ? "Revoking…" : "Revoke consent"}
          </Button>
        </form>
      ) : (
        <form action={acceptAction}>
          <input type="hidden" name="projectId" value={current.projectId} />
          <Button type="submit" disabled={acceptPending}>
            {acceptPending ? "Granting…" : "Accept and grant consent"}
          </Button>
        </form>
      )}

      {state?.message && (
        <p className={`text-sm ${state.ok ? "text-aqua-400" : "text-crit"}`}>{state.message}</p>
      )}
    </div>
  );
}

function ConsentBadge({ status, version }: { status: ProjectConsent["status"]; version: string | null }) {
  if (status === "granted") {
    return (
      <span className="rounded-full bg-aqua-500/10 px-2 py-0.5 text-[11px] font-medium text-aqua-400">
        Granted{version ? ` · ${version}` : ""}
      </span>
    );
  }
  if (status === "revoked") {
    return (
      <span className="rounded-full bg-crit/10 px-2 py-0.5 text-[11px] font-medium text-crit">
        Revoked
      </span>
    );
  }
  return (
    <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[11px] font-medium text-fog-400">
      Not granted
    </span>
  );
}
