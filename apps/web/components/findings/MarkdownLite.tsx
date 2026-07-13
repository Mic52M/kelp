"use client";

// Minimal, XSS-safe Markdown renderer for the finding-chat (#39) + reused
// wherever we render model-authored / prompt-shaped text (fix prompts,
// finding explanations that contain code).
//
// Why not react-markdown? For 1500 lines of chat output on a security product
// we want zero-dependency and a review-able allowlist. This renderer supports
// exactly the subset the system prompt (chat.ts rule 10) tells the model to
// emit — no headings, no tables, no images, no links except allow-list.
// Everything reaches React as text children (never dangerouslySetInnerHTML),
// so a stray "<script>" surfaces as harmless text.

import { Fragment, useState, type ReactNode } from "react";

const ALLOWED_DOMAINS_RE =
  /^https?:\/\/(?:[a-z0-9-]+\.)*(?:kelp\.dev|owasp\.org|cwe\.mitre\.org|mozilla\.org|github\.com|githubusercontent\.com)(?:\/.*)?$/i;

/** Inline pass: **bold**, `code`, and allow-listed [text](url). */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  let buf = "";
  let n = 0;

  const flush = () => {
    if (buf) {
      out.push(<Fragment key={`${keyPrefix}-t-${n++}`}>{buf}</Fragment>);
      buf = "";
    }
  };

  while (i < text.length) {
    // Inline code `…`
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i) {
        flush();
        const code = text.slice(i + 1, end);
        out.push(
          <code
            key={`${keyPrefix}-c-${n++}`}
            className="rounded bg-[color:var(--color-ink-900)] px-1.5 py-0.5 font-mono text-[12px] text-[color:var(--color-paper-100)]"
          >
            {code}
          </code>,
        );
        i = end + 1;
        continue;
      }
    }

    // Bold **…**
    if (text[i] === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        const inner = text.slice(i + 2, end);
        out.push(
          <strong key={`${keyPrefix}-b-${n++}`} className="text-[color:var(--color-paper-50)] font-medium">
            {renderInline(inner, `${keyPrefix}-b${n}`)}
          </strong>,
        );
        i = end + 2;
        continue;
      }
    }

    // Allow-listed [text](url)
    if (text[i] === "[") {
      const linkMatch = text.slice(i).match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/);
      if (linkMatch) {
        const [full, label, url] = linkMatch;
        if (ALLOWED_DOMAINS_RE.test(url!)) {
          flush();
          out.push(
            <a
              key={`${keyPrefix}-a-${n++}`}
              href={url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[color:var(--color-signal)] underline underline-offset-2 hover:text-[color:var(--color-paper-50)]"
            >
              {label}
            </a>,
          );
          i += full!.length;
          continue;
        }
        // Non-allow-listed link → render as plain text (label + bare url stripped).
        flush();
        out.push(<Fragment key={`${keyPrefix}-l-${n++}`}>{label}</Fragment>);
        i += full!.length;
        continue;
      }
    }

    buf += text[i]!;
    i++;
  }
  flush();
  return out;
}

/** Split input into blocks: paragraphs, fenced code, and list items. */
export function MarkdownLite({ children }: { children: string }) {
  // Normalize CRLF. HTML in the string is NOT pre-escaped — React auto-escapes
  // text children when it renders, and pre-escaping produces literal &#39;
  // etc. on screen. We render everything through React text nodes (never
  // dangerouslySetInnerHTML), so a stray "<script>" in the model's output
  // is displayed as harmless text.
  const raw = (children ?? "").replace(/\r\n/g, "\n");

  const lines = raw.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code ```lang\n…\n```
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const start = i + 1;
      let end = start;
      while (end < lines.length && !/^```/.test(lines[end]!)) end++;
      const code = lines.slice(start, end).join("\n");
      blocks.push(<CodeBlock key={`p-${key++}`} lang={lang} code={code} />);
      i = end + 1;
      continue;
    }

    // Blank line → skip
    if (!line.trim()) {
      i++;
      continue;
    }

    // Numbered list — collect consecutive `N. …` lines.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={`p-${key++}`} className="my-2 list-decimal space-y-1 pl-5">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `li-${key}-${idx}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Bulleted list — `- ` or `* ` (but not `**` which is bold).
    if (/^\s*[-*]\s+(?!\*)/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+(?!\*)/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={`p-${key++}`} className="my-2 list-disc space-y-1 pl-5">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `bli-${key}-${idx}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Paragraph — merge consecutive non-blank, non-list, non-fence lines.
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^```/.test(lines[i]!) &&
      !/^\s*\d+\.\s+/.test(lines[i]!) &&
      !/^\s*[-*]\s+(?!\*)/.test(lines[i]!)
    ) {
      para.push(lines[i]!);
      i++;
    }
    blocks.push(
      <p key={`p-${key++}`} className="my-2 leading-[1.65] first:mt-0 last:mb-0">
        {renderInline(para.join(" "), `pr-${key}`)}
      </p>,
    );
  }

  return <div className="markdown-lite">{blocks}</div>;
}

/** Claude/ChatGPT-style code block: language pill (top-left), copy button
 *  (top-right), dark inset body. Used for fenced blocks in MarkdownLite AND
 *  as a standalone renderer for the fix-prompt panel and any other place
 *  we show model-authored / prompt-shaped code. */
export function CodeBlock({ lang, code }: { lang?: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const langLabel = (lang ?? "").trim();

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="my-3 overflow-hidden border border-[color:var(--color-hair-strong)] bg-[color:var(--color-ink-950,#08090A)]">
      <div className="flex items-center justify-between border-b border-[color:var(--color-hair)] bg-[color:var(--color-ink-900)] px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-paper-500)]">
          {langLabel || "code"}
        </span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 border border-transparent px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-400)] transition-colors hover:border-[color:var(--color-hair-strong)] hover:text-[color:var(--color-paper-100)]"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-3 font-mono text-[12px] leading-[1.65] text-[color:var(--color-paper-100)]">
        <code>{code}</code>
      </pre>
    </div>
  );
}
