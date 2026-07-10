"use client";

// Inline "How do I get this?" collapsible shown under each Settings input.
// Three zones — what it is, where to get it (per platform tabs), or a
// paste-ready AI prompt. Zero JS for the open/close (uses <details>), just
// a small state for the platform tab selector.

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
    <details className="group mt-2 rounded-xl border border-line/60 bg-ink-900/30 open:border-line/80">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-900/60">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-fog-500/10 px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-wider text-fog-400">
            How to
          </span>
          <span className="text-[13px] font-medium text-fog-100">{title}</span>
        </div>
        <span className="text-fog-400 transition-transform group-open:rotate-180" aria-hidden>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="m6 8 4 4 4-4" />
          </svg>
        </span>
      </summary>

      <div className="border-t border-line/60 px-4 pb-4 pt-4 text-sm leading-relaxed text-fog-300">
        <p className="text-[13px] text-fog-200">{content.whatIsIt}</p>

        <div className="mt-4">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-fog-500">
            Where to get it
          </div>
          <div className="flex flex-wrap gap-1.5">
            {content.platforms.map((p) => {
              const on = p.platform === (active?.platform ?? content.platforms[0]?.platform);
              return (
                <button
                  key={p.platform}
                  type="button"
                  onClick={() => setPlatform(p.platform)}
                  className={`rounded-full px-3 py-1 text-[11px] transition-colors ${
                    on
                      ? "bg-aqua-500/15 text-aqua-300"
                      : "border border-line/70 bg-ink-900/60 text-fog-400 hover:text-fog-200"
                  }`}
                >
                  {p.platform}
                </button>
              );
            })}
          </div>
          {active && (
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[13px] text-fog-300">
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
              className="mt-3 inline-flex items-center gap-1 text-[12px] text-aqua-400 hover:text-aqua-300"
            >
              {active.link.label} <span aria-hidden>↗</span>
            </a>
          )}
        </div>

        {content.prompt && (
          <div className="mt-5">
            <div className="mb-1.5 flex items-baseline justify-between">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-fog-500">
                Or paste this into {content.prompt.target}
              </div>
            </div>
            <CopyBlock
              label={`Paste into ${content.prompt.target}`}
              body={content.prompt.body}
              language={content.prompt.target.includes("SQL") ? "sql" : "prompt"}
            />
          </div>
        )}

        {content.secondary && (
          <div className="mt-4">
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-fog-500">
              Doing it by hand? Paste this into {content.secondary.target}
            </div>
            <CopyBlock
              label={`Paste into ${content.secondary.target}`}
              body={content.secondary.body}
              language={content.secondary.target.includes("SQL") ? "sql" : "prompt"}
            />
          </div>
        )}

        {content.caveat && (
          <p className="mt-4 border-l-2 border-line/60 pl-3 text-[12px] text-fog-500">
            {content.caveat}
          </p>
        )}
      </div>
    </details>
  );
}
