"use client";

// Code block with a Copy-to-clipboard button. Used inside SetupGuide for the
// AI prompts and inline SQL snippets. Kept minimal — no syntax highlighting,
// so it also reads well as plain text if a user copies visually.

import { useState } from "react";

export function CopyBlock({
  label,
  body,
  language = "text",
}: {
  /** Small caption above the block, e.g. "Paste into Supabase → SQL Editor". */
  label?: string;
  body: string;
  /** Purely decorative — shown as a tiny chip on the right of the label. */
  language?: string;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard blocked — fall back to a visible select.
      const selection = window.getSelection();
      const range = document.createRange();
      const node = document.getElementById(nodeId);
      if (node && selection) {
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  }
  const nodeId = `copy-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <div className="rounded-lg border border-line/60 bg-ink-950/60">
      {(label || language) && (
        <div className="flex items-center justify-between border-b border-line/50 px-3 py-1.5">
          <span className="text-[11px] uppercase tracking-wider text-fog-500">
            {label ?? language}
          </span>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-ink-800 px-2 py-0.5 text-[10px] text-fog-500">
              {language}
            </span>
            <button
              type="button"
              onClick={copy}
              className="rounded-md border border-line/70 bg-ink-800/80 px-2 py-0.5 text-[11px] text-fog-200 transition-colors hover:border-aqua-600/50 hover:text-aqua-300"
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </div>
      )}
      <pre
        id={nodeId}
        className="max-h-72 overflow-auto whitespace-pre px-3 py-2.5 font-mono text-[12px] leading-relaxed text-fog-200"
      >
        {body}
      </pre>
    </div>
  );
}
