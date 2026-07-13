"use client";

import { useState } from "react";
import type { Finding, FindingEvidence } from "@/lib/types";

// "How Kelp verified this" (#43) — surfaces the deterministic evidence
// gate behind each finding. Data source: apps/web/lib/data.ts → buildEvidence.
//
// For agent findings: shows the attacked surface + endpoint, the observable
// the executor accepted (the "[Kelp confirmed: …]" tail on the persisted
// evidence string), and an optional transcript slice under <details>.
// For deterministic passive findings: shows a shorter "How we detected this"
// note derived from the finding class (secret ruleId / RLS table).

export function EvidencePanel({ finding }: { finding: Finding }) {
  const ev = finding.evidence;
  if (!ev) return null;

  return (
    <section className="mt-6 border border-[color:var(--color-hair)]">
      <header className="border-b border-[color:var(--color-hair)] px-4 py-2.5">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-400)]">
          How Kelp verified this
        </div>
      </header>
      <div className="px-4 py-4">
        {ev.kind === "agent" ? (
          <AgentEvidence ev={ev} />
        ) : ev.kind === "passive-secret" ? (
          <PassiveSecretEvidence ev={ev} />
        ) : ev.kind === "passive-rls" ? (
          <PassiveRlsEvidence ev={ev} />
        ) : (
          <GenericEvidence />
        )}
      </div>
    </section>
  );
}

function AgentEvidence({ ev }: { ev: FindingEvidence }) {
  return (
    <div className="space-y-3">
      <p className="max-w-[68ch] text-[13.5px] leading-[1.7] text-[color:var(--color-paper-300)]">
        A Kelp specialist proved this by re-running the reproduction it proposed.
        The finding is only recorded when the executor sees the expected observable.
      </p>
      <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-5 gap-y-2 text-[12.5px]">
        {ev.surface && <Row label="Surface" value={ev.surface} mono />}
        {ev.endpoint && <Row label="Endpoint" value={ev.endpoint} mono />}
        {ev.confirmedWhy && <Row label="Observed" value={ev.confirmedWhy} />}
      </dl>
      {ev.transcript && ev.transcript.length > 0 && (
        <TranscriptDetails specialist={ev.specialist} transcript={ev.transcript} />
      )}
    </div>
  );
}

function PassiveSecretEvidence({ ev }: { ev: FindingEvidence }) {
  return (
    <div className="space-y-3">
      <p className="max-w-[68ch] text-[13.5px] leading-[1.7] text-[color:var(--color-paper-300)]">
        Detected by Kelp&rsquo;s deterministic secret scanner
        {ev.provider ? <> ({ev.provider} rule).</> : "."} No probes were run —
        the match is on a high-precision pattern in your source.
      </p>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-5 gap-y-2 text-[12.5px]">
        {ev.ruleId && <Row label="Rule" value={ev.ruleId} mono />}
        {ev.endpoint && <Row label="Location" value={ev.endpoint} mono />}
        {ev.preview && <Row label="Match" value={ev.preview} mono />}
      </dl>
    </div>
  );
}

function PassiveRlsEvidence({ ev }: { ev: FindingEvidence }) {
  return (
    <div className="space-y-3">
      <p className="max-w-[68ch] text-[13.5px] leading-[1.7] text-[color:var(--color-paper-300)]">
        Detected by Kelp&rsquo;s deterministic RLS audit against your Supabase
        catalog. The table is API-exposed and its policy configuration was read
        directly from Postgres.
      </p>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-5 gap-y-2 text-[12.5px]">
        {ev.endpoint && <Row label="Table" value={ev.endpoint} mono />}
      </dl>
    </div>
  );
}

function GenericEvidence() {
  return (
    <p className="max-w-[68ch] text-[13.5px] leading-[1.7] text-[color:var(--color-paper-300)]">
      Verified by Kelp before it was recorded.
    </p>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
        {label}
      </dt>
      <dd
        className={
          mono
            ? "break-all font-mono text-[12px] leading-[1.7] text-[color:var(--color-paper-100)]"
            : "text-[13px] leading-[1.7] text-[color:var(--color-paper-200)]"
        }
      >
        {value}
      </dd>
    </>
  );
}

function TranscriptDetails({
  specialist,
  transcript,
}: {
  specialist?: string;
  transcript: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 border border-[color:var(--color-hair)]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
          Raw transcript
          {specialist ? (
            <span className="ml-2 text-[color:var(--color-paper-400)]">· {specialist}</span>
          ) : null}
          <span className="ml-2 text-[color:var(--color-paper-500)]">
            ({transcript.length} step{transcript.length === 1 ? "" : "s"})
          </span>
        </span>
        <span className="font-mono text-[10.5px] text-[color:var(--color-paper-500)]">
          {open ? "hide" : "show"}
        </span>
      </button>
      {open && (
        <ol className="max-h-[420px] overflow-y-auto border-t border-[color:var(--color-hair)] bg-[color:var(--color-ink-1000)] px-4 py-3 font-mono text-[11.5px] leading-[1.75] text-[color:var(--color-paper-200)]">
          {transcript.map((step, i) => (
            <li key={i} className="border-b border-[color:var(--color-hair)] py-2 last:border-b-0">
              <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
                step {i + 1}
              </div>
              <pre className="whitespace-pre-wrap break-words">{step}</pre>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
