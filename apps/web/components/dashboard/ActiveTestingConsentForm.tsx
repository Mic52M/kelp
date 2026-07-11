"use client";

// Consent v3 UI, editorial anchor.
//   · legible: real document typography (line-height, section headings).
//   · scannable: numbered SECTION HEADINGS bubble to the top of each block.
//   · trust-building: post-accept shows the "signed record" and offers download.

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
  consentedByEmail: string | null;
  orgName: string | null;
}

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
      <p className="font-mono text-[12px] text-[color:var(--color-paper-500)]">
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
    <div className="space-y-6">
      {/* Project picker */}
      {consents.length > 1 && (
        <div>
          <label className="mb-2 block font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
            Project
          </label>
          <div className="relative">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="w-full appearance-none border-b border-[color:var(--color-hair)] bg-transparent px-0 py-2 pr-8 text-[13px] text-[color:var(--color-paper-50)] outline-none transition-colors focus:border-[color:var(--color-signal)]"
            >
              {consents.map((c) => (
                <option
                  key={c.projectId}
                  value={c.projectId}
                  className="bg-[color:var(--color-ink-900)] text-[color:var(--color-paper-50)]"
                >
                  {c.projectName}
                </option>
              ))}
            </select>
            <svg
              aria-hidden
              className="pointer-events-none absolute right-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--color-paper-400)]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </div>
      )}

      {/* Consent document */}
      <article className="border border-[color:var(--color-hair)]">
        <header className="flex items-center justify-between border-b border-[color:var(--color-hair)] px-6 py-4">
          <div>
            <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
              § Consent document
            </div>
            <div className="mt-2 font-display text-[18px] leading-[1.2] text-[color:var(--color-paper-50)]">
              Active security testing authorization
            </div>
            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
              Version {version}
            </div>
          </div>
          <ConsentBadge status={current.status} version={current.version} />
        </header>

        <div className="max-h-[520px] overflow-y-auto px-6 py-6 text-[14px] leading-[1.75] text-[color:var(--color-paper-100)]">
          {intro && <p className="mb-6 whitespace-pre-wrap">{intro}</p>}
          <ol className="space-y-6">
            {sections.map((s, i) => (
              <li key={i}>
                {s.heading && (
                  <h4 className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-paper-50)]">
                    {s.heading}
                  </h4>
                )}
                <p className="whitespace-pre-wrap text-[color:var(--color-paper-300)]">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </article>

      {staleVersion && (
        <div
          className="border-l px-4 py-3 text-[13px] leading-relaxed"
          style={{ borderColor: "var(--color-sev-high)", color: "var(--color-paper-100)" }}
        >
          Your existing consent is version{" "}
          <span className="text-[color:var(--color-paper-50)]">{current.version}</span>. Kelp
          updated the copy to <span className="text-[color:var(--color-paper-50)]">{version}</span>{" "}
          — please re-accept to keep multi-agent campaigns running.
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
        <p
          className="border-l px-4 py-2 font-mono text-[12px] leading-relaxed"
          style={{
            borderColor: state.ok ? "var(--color-signal)" : "var(--color-sev-crit)",
            color: state.ok ? "var(--color-signal)" : "var(--color-sev-crit)",
          }}
        >
          {state.message}
        </p>
      )}

      {/* Signed-record block */}
      {current.status === "granted" && current.consentedAt && (
        <div
          className="border p-6"
          style={{ borderColor: "var(--color-signal-dim)" }}
        >
          <div
            className="font-mono text-[10.5px] uppercase tracking-[0.16em]"
            style={{ color: "var(--color-signal)" }}
          >
            § Signed record
          </div>
          <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            <SignedRow label="Signer" value={current.consentedByEmail ?? "unknown"} />
            <SignedRow label="Organization" value={current.orgName ?? "—"} />
            <SignedRow label="Project" value={current.projectName} />
            <SignedRow label="Version" value={current.version ?? "—"} />
            <SignedRow label="Timestamp" value={formatTimestamp(current.consentedAt)} wide />
          </dl>
          <a
            href={`/dashboard/settings/consent-download?projectId=${current.projectId}`}
            className="mt-5 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors"
            style={{ color: "var(--color-signal)" }}
          >
            Download signed consent (.txt) <span aria-hidden>↓</span>
          </a>
        </div>
      )}

      <p className="text-[11.5px] leading-[1.7] text-[color:var(--color-paper-500)]">
        The consent copy above is a Kelp-provided template intended for developer convenience, not
        legal advice. For production use in regulated jurisdictions (EU/UK, US HIPAA/FTC, etc.),
        have your counsel review the wording before shipping. The load-bearing record is the row
        Kelp writes to{" "}
        <code className="bg-[color:var(--color-ink-800)] px-1 font-mono text-[10.5px] text-[color:var(--color-paper-100)]">
          active_test_consents
        </code>{" "}
        — verbatim text, signer, UTC timestamp, and version — which you can download at any time.
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
      <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
        {label}
      </dt>
      <dd className="mt-1.5 font-mono text-[12.5px] text-[color:var(--color-paper-50)]">
        {value}
      </dd>
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
  const map = {
    granted: { color: "var(--color-signal)", text: `Granted${version ? ` · ${version}` : ""}` },
    revoked: { color: "var(--color-sev-crit)", text: "Revoked" },
    none: { color: "var(--color-paper-400)", text: "Not granted" },
  } as const;
  const s = map[status];
  return (
    <span
      className="inline-flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.16em]"
      style={{ color: s.color }}
    >
      <span
        className="inline-block"
        style={{ width: 2, height: 10, background: s.color }}
        aria-hidden
      />
      {s.text}
    </span>
  );
}
