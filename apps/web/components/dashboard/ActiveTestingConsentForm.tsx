"use client";

// Consent v3 UI. The audience: a vibe coder who has probably never read a
// consent form. Goals for this render:
//   · legible: real document typography (line-height, section headings),
//     not a cramped monospace pre.
//   · scannable: numbered SECTION HEADINGS bubble to the top of each block
//     so a first read takes 20 seconds.
//   · trust-building: post-accept we show the "signed record" (email, org,
//     UTC timestamp, version) and offer a download of the exact text.
//
// Note: the consent copy itself is a template — see the caveat at the bottom
// of the card. The load-bearing legal artifact is the row we write to
// active_test_consents (verbatim text + version + signer + timestamp).

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
  /** Signer's email — nullable if the user was deleted after signing. */
  consentedByEmail: string | null;
  /** Human-readable org name. */
  orgName: string | null;
}

/** Split the CONSENT_V3_TEXT (or v2 fallback) into an intro paragraph +
 *  numbered sections so the UI can render each as a proper heading + body.
 *  Falls back to a single unstructured block if the copy doesn't match the
 *  numbered pattern (safe for v1/v2). */
function splitConsent(copy: string): {
  intro: string;
  sections: { heading: string; body: string }[];
} {
  const parts = copy.split(/\n\s*(?=\d{1,2}\.)/);
  const intro = parts.shift() ?? "";
  const sections: { heading: string; body: string }[] = [];
  for (const p of parts) {
    const m = p.match(/^(\d{1,2}\.\s+[A-Z][A-Z0-9 ,/&()-]{2,})\n([\s\S]*)$/);
    if (m) {
      sections.push({ heading: m[1]!.trim(), body: m[2]!.trim() });
    } else {
      sections.push({ heading: "", body: p.trim() });
    }
  }
  return { intro: intro.trim(), sections };
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return (
    d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC") +
    ` · ${d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`
  );
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
    return (
      <p className="text-sm text-fog-500">
        Connect a project to enable active-testing consent.
      </p>
    );
  }

  const current = consents.find((c) => c.projectId === selected) ?? consents[0]!;
  const state = accept?.message ? accept : revoke;
  const { intro, sections } = splitConsent(copy);
  const staleVersion =
    current.status === "granted" && current.version !== null && current.version !== version;

  return (
    <div className="space-y-5">
      {/* Project picker */}
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

      {/* Consent document — full width, document typography */}
      <article className="rounded-2xl border border-line/70 bg-ink-900/40 shadow-inner">
        <header className="flex items-center justify-between border-b border-line/50 px-6 py-4">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-fog-500">
              Consent document
            </div>
            <div className="mt-0.5 text-sm text-fog-200">
              Active security testing authorization ·{" "}
              <span className="text-fog-400">version {version}</span>
            </div>
          </div>
          <ConsentBadge status={current.status} version={current.version} />
        </header>

        <div className="max-h-[520px] overflow-y-auto px-6 py-6 text-[14px] leading-[1.7] text-fog-200">
          {intro && <p className="mb-5 whitespace-pre-wrap">{intro}</p>}
          <ol className="space-y-5">
            {sections.map((s, i) => (
              <li key={i}>
                {s.heading && (
                  <h4 className="mb-1.5 text-[13px] font-semibold uppercase tracking-[0.12em] text-fog-100">
                    {s.heading}
                  </h4>
                )}
                <p className="whitespace-pre-wrap text-fog-300">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </article>

      {staleVersion && (
        <div className="rounded-lg border border-[color:var(--color-high)]/30 bg-[color:var(--color-high)]/[0.06] px-4 py-3 text-sm text-fog-200">
          Your existing consent is version <b>{current.version}</b>. Kelp updated the copy
          to <b>{version}</b> — please re-accept to keep multi-agent campaigns running.
        </div>
      )}

      {/* Accept / Revoke */}
      {current.status === "granted" && !staleVersion ? (
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

      {/* Signed-record block — only meaningful once accepted */}
      {current.status === "granted" && current.consentedAt && (
        <div className="rounded-xl border border-aqua-600/25 bg-aqua-500/[0.04] px-5 py-4">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-aqua-300">
            Signed record
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
            <SignedRow label="Signer" value={current.consentedByEmail ?? "unknown"} />
            <SignedRow label="Organization" value={current.orgName ?? "—"} />
            <SignedRow label="Project" value={current.projectName} />
            <SignedRow label="Version" value={current.version ?? "—"} />
            <SignedRow
              label="Timestamp"
              value={formatTimestamp(current.consentedAt)}
              wide
            />
          </dl>
          <a
            href={`/dashboard/settings/consent-download?projectId=${current.projectId}`}
            className="mt-3 inline-flex items-center gap-1 text-[12px] text-aqua-400 hover:text-aqua-300"
          >
            Download signed consent (.txt) <span aria-hidden>↓</span>
          </a>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-fog-500">
        The consent copy above is a Kelp-provided template intended for developer
        convenience, not legal advice. For production use in regulated
        jurisdictions (EU/UK, US HIPAA/FTC, etc.), have your counsel review the
        wording before shipping. The load-bearing record is the row Kelp writes
        to <code className="rounded bg-ink-800 px-1">active_test_consents</code> —
        verbatim text, signer, UTC timestamp, and version — which you can
        download at any time.
      </p>
    </div>
  );
}

function SignedRow({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-[11px] uppercase tracking-wider text-fog-500">{label}</dt>
      <dd className="mt-0.5 font-mono text-[12.5px] text-fog-100">{value}</dd>
    </div>
  );
}

function ConsentBadge({
  status,
  version,
}: {
  status: ProjectConsent["status"];
  version: string | null;
}) {
  if (status === "granted") {
    return (
      <span className="rounded-full bg-aqua-500/10 px-2.5 py-1 text-[11px] font-medium text-aqua-400">
        Granted{version ? ` · ${version}` : ""}
      </span>
    );
  }
  if (status === "revoked") {
    return (
      <span className="rounded-full bg-crit/10 px-2.5 py-1 text-[11px] font-medium text-crit">
        Revoked
      </span>
    );
  }
  return (
    <span className="rounded-full bg-ink-700 px-2.5 py-1 text-[11px] font-medium text-fog-400">
      Not granted
    </span>
  );
}
