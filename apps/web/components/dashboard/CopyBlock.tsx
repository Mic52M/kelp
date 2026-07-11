"use client";

import { useState } from "react";

export function CopyBlock({
  label,
  body,
  language = "text",
}: {
  label?: string;
  body: string;
  language?: string;
}) {
  const [copied, setCopied] = useState(false);
  const nodeId = `copy-${Math.random().toString(36).slice(2, 8)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
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

  return (
    <div className="border border-[color:var(--color-hair)]">
      {(label || language) && (
        <div className="flex items-center justify-between border-b border-[color:var(--color-hair)] px-3 py-2">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
            {label ?? language}
          </span>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
              {language}
            </span>
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center border border-[color:var(--color-hair-strong)] px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-100)] transition-colors hover:border-[color:var(--color-paper-400)]"
            >
              {copied ? (
                <span style={{ color: "var(--color-signal)" }}>Copied ✓</span>
              ) : (
                "Copy"
              )}
            </button>
          </div>
        </div>
      )}
      <pre
        id={nodeId}
        className="max-h-72 overflow-auto whitespace-pre bg-[color:var(--color-ink-1000)] px-4 py-3 font-mono text-[12px] leading-[1.75] text-[color:var(--color-paper-100)]"
      >
        {body}
      </pre>
    </div>
  );
}
