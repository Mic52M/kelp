"use client";

// Copy-to-clipboard row for the shareable report (#33). Shows:
// - the /r/<slug> URL (canonical)
// - a markdown badge snippet ready to paste into a README
// - X / LinkedIn share links
//
// Editorial-industrial: hairline borders, mono, single accent for the "copied"
// state. No JS-heavy libraries.

import { useState } from "react";

interface Props {
  slug: string;
  repoUrl: string;
}

function shortRepo(u: string): string {
  return u.replace(/^https:\/\/github\.com\//, "");
}

export function ShareRow({ slug, repoUrl }: Props) {
  const [copied, setCopied] = useState<string | null>(null);

  // We can't know the actual public origin at render time on the server (SSR
  // may run behind a proxy); build absolute URLs from the current window when
  // available, falling back to "https://kelp.build".
  const origin = typeof window !== "undefined" ? window.location.origin : "https://kelp.build";
  const reportUrl = `${origin}/r/${slug}`;
  const badgeMarkdown = `[![Scanned by Kelp](${origin}/r/${slug}/badge)](${reportUrl})`;
  const shareText = encodeURIComponent(
    `Kelp scanned ${shortRepo(repoUrl)} for security holes — full report:`,
  );
  const xUrl = `https://x.com/intent/tweet?text=${shareText}&url=${encodeURIComponent(reportUrl)}`;
  const liUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(reportUrl)}`;

  async function copy(what: string, key: string) {
    try {
      await navigator.clipboard.writeText(what);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="border border-[color:var(--color-hair-strong)]">
      <div className="border-b border-[color:var(--color-hair)] px-5 py-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
          Share this report
        </span>
      </div>

      <div className="grid grid-cols-1 divide-y divide-[color:var(--color-hair)]">
        <div className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <code
            className="truncate font-mono text-[12.5px] text-[color:var(--color-paper-300)]"
            title={reportUrl}
          >
            {reportUrl}
          </code>
          <button
            type="button"
            onClick={() => copy(reportUrl, "url")}
            className="justify-self-start border border-[color:var(--color-hair-strong)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-300)] transition-colors hover:border-[color:var(--color-paper-400)] hover:text-[color:var(--color-paper-50)] sm:justify-self-end"
          >
            {copied === "url" ? "Copied ✓" : "Copy link"}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <code className="truncate font-mono text-[11.5px] text-[color:var(--color-paper-500)]" title={badgeMarkdown}>
            {badgeMarkdown}
          </code>
          <button
            type="button"
            onClick={() => copy(badgeMarkdown, "badge")}
            className="justify-self-start border border-[color:var(--color-hair-strong)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-300)] transition-colors hover:border-[color:var(--color-paper-400)] hover:text-[color:var(--color-paper-50)] sm:justify-self-end"
          >
            {copied === "badge" ? "Copied ✓" : "Copy badge"}
          </button>
        </div>

        <div className="flex flex-wrap gap-2 px-5 py-4">
          <a
            href={xUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="border border-[color:var(--color-hair-strong)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-300)] transition-colors hover:border-[color:var(--color-paper-400)] hover:text-[color:var(--color-paper-50)]"
          >
            Share on X
          </a>
          <a
            href={liUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="border border-[color:var(--color-hair-strong)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-300)] transition-colors hover:border-[color:var(--color-paper-400)] hover:text-[color:var(--color-paper-50)]"
          >
            Share on LinkedIn
          </a>
        </div>
      </div>
    </div>
  );
}
