// Big copyable install command. The primary CTA on the OSS landing —
// designed to read exactly like `bun install` or `curl … | sh` boxes on the
// top OSS project sites. One line, prominent, one click copies.

"use client";

import { useState } from "react";

export function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard denied (Safari private mode etc.) — silently ignore; the
      // user can still select the command text with the mouse.
    }
  }

  return (
    <div className="group relative flex w-full items-center justify-between gap-4 border border-[color:var(--color-hair-strong)] bg-[color:var(--color-ink-900)] px-5 py-4 transition-colors hover:border-[color:var(--color-signal-dim)]">
      <code className="font-mono text-[15px] leading-none text-[color:var(--color-paper-100)] sm:text-[17px]">
        <span className="text-[color:var(--color-signal-dim)]">$ </span>
        {command}
      </code>
      <button
        onClick={copy}
        type="button"
        aria-label="Copy command"
        className="shrink-0 border-l border-[color:var(--color-hair)] pl-4 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)] transition-colors hover:text-[color:var(--color-signal)]"
      >
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}
