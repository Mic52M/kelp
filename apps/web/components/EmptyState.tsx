// Empty state — hairline box, mono eyebrow, editorial voice. No decorative
// icons unless a page passes one explicitly.

import Link from "next/link";
import { buttonClasses } from "./Button";

interface EmptyStateProps {
  title: string;
  body: string;
  cta?: { href: string; label: string };
  icon?: React.ReactNode;
  eyebrow?: string;
}

export function EmptyState({ title, body, cta, icon, eyebrow = "Nothing here yet" }: EmptyStateProps) {
  return (
    <div className="border border-[color:var(--color-hair)] px-8 py-16">
      <div className="mx-auto max-w-md text-center">
        {icon && (
          <div className="mx-auto mb-6 flex h-10 w-10 items-center justify-center border border-[color:var(--color-hair-strong)] text-[color:var(--color-paper-300)]">
            {icon}
          </div>
        )}
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
          {eyebrow}
        </div>
        <h3 className="font-display mt-4 text-[26px] leading-[1.15] text-[color:var(--color-paper-50)]">
          {title}
        </h3>
        <p className="mx-auto mt-3 max-w-sm text-[13.5px] leading-[1.65] text-[color:var(--color-paper-300)]">
          {body}
        </p>
        {cta && (
          <Link href={cta.href} className={buttonClasses("primary", "md", "mt-7")}>
            {cta.label}
          </Link>
        )}
      </div>
    </div>
  );
}
