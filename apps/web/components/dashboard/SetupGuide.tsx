"use client";

// Inline "How do I get this?" collapsible shown under each setup input.
// Editorial anchor — hairline shell, mono eyebrow, hairline "tabs".

import { useState } from "react";
import { CopyBlock } from "./CopyBlock";
import type { SetupGuideContent } from "@/lib/setup-guides";

export function SetupGuide({
  title = "How do I get this?",
  content,
}: {
  title?: string;
  content: SetupGuideContent;
}) {
  const [platform, setPlatform] = useState(content.platforms[0]?.platform);
  const active = content.platforms.find((p) => p.platform === platform) ?? content.platforms[0];

  return (
    <details className="group border border-[color:var(--color-hair)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[color:var(--color-ink-850)]">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
            How-to
          </span>
          <span className="text-[13px] text-[color:var(--color-paper-100)]">{title}</span>
        </div>
        <span
          className="text-[color:var(--color-paper-400)] transition-transform group-open:rotate-180"
          aria-hidden
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
          >
            <path d="m6 8 4 4 4-4" />
          </svg>
        </span>
      </summary>

      <div className="space-y-6 border-t border-[color:var(--color-hair)] px-5 pb-5 pt-5">
        <p className="text-[13px] leading-[1.7] text-[color:var(--color-paper-100)]">
          {content.whatIsIt}
        </p>

        <div>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
            § Where to get it
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {content.platforms.map((p) => {
              const on = p.platform === (active?.platform ?? content.platforms[0]?.platform);
              return (
                <button
                  key={p.platform}
                  type="button"
                  onClick={() => setPlatform(p.platform)}
                  className="border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors"
                  style={{
                    borderColor: on
                      ? "var(--color-signal-dim)"
                      : "var(--color-hair)",
                    color: on ? "var(--color-signal)" : "var(--color-paper-400)",
                  }}
                >
                  {p.platform}
                </button>
              );
            })}
          </div>
          {active && (
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-[13px] leading-[1.7] text-[color:var(--color-paper-300)]">
              {active.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          )}
          {active?.link && (
            <a
              href={active.link.href}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-1 font-mono text-[11.5px] uppercase tracking-[0.14em] transition-colors"
              style={{ color: "var(--color-signal)" }}
            >
              {active.link.label} <span aria-hidden>↗</span>
            </a>
          )}
        </div>

        {content.prompt && (
          <div>
            <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
              § Or paste this into {content.prompt.target}
            </div>
            <CopyBlock
              label={`Paste into ${content.prompt.target}`}
              body={content.prompt.body}
              language={content.prompt.target.includes("SQL") ? "sql" : "prompt"}
            />
          </div>
        )}

        {content.secondary && (
          <div>
            <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
              § Doing it by hand? Paste this into {content.secondary.target}
            </div>
            <CopyBlock
              label={`Paste into ${content.secondary.target}`}
              body={content.secondary.body}
              language={content.secondary.target.includes("SQL") ? "sql" : "prompt"}
            />
          </div>
        )}

        {content.caveat && (
          <p className="border-l border-[color:var(--color-hair-strong)] pl-4 text-[12px] leading-[1.7] text-[color:var(--color-paper-500)]">
            {content.caveat}
          </p>
        )}
      </div>
    </details>
  );
}
