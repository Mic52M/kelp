// Coherent empty state for list surfaces (Projects, Findings, …).
// Restrained: a subtle icon block, a title, one line of context, one primary CTA.

import Link from "next/link";
import { buttonClasses } from "./Button";

interface EmptyStateProps {
  title: string;
  body: string;
  cta?: { href: string; label: string };
  /** small illustrative glyph (SVG element) shown above the title */
  icon?: React.ReactNode;
}

const DEFAULT_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-6 w-6"
  >
    <path d="M12 2L4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6l-8-4z" />
  </svg>
);

export function EmptyState({ title, body, cta, icon }: EmptyStateProps) {
  return (
    <div className="rounded-2xl border border-line/60 bg-ink-900/30 px-6 py-16 text-center">
      <div className="mx-auto mb-4 inline-flex h-11 w-11 items-center justify-center rounded-full border border-line bg-ink-800/60 text-aqua-400">
        {icon ?? DEFAULT_ICON}
      </div>
      <h3 className="text-base font-semibold text-fog-50">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-fog-400">{body}</p>
      {cta && (
        <Link href={cta.href} className={buttonClasses("primary", "md", "mt-5")}>
          {cta.label}
        </Link>
      )}
    </div>
  );
}
