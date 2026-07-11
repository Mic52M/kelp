// Editorial page hero — Fraunces title, mono eyebrow, hairline rule.
// Kept as two exports to preserve compatibility with existing pages:
//   PageHeader  — thin top-strip label used at the very top of some pages
//   PageHero    — the big page opener (Fraunces headline)

export function PageHeader({
  title,
  email,
  action,
}: {
  title: string;
  email?: string | null;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex items-center gap-4 border-b border-[color:var(--color-hair)] px-8 py-4">
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
        {title}
      </span>
      <div className="ml-auto flex items-center gap-4">
        {action}
        {email && (
          <span className="hidden font-mono text-[11.5px] text-[color:var(--color-paper-400)] sm:inline">
            {email}
          </span>
        )}
      </div>
    </header>
  );
}

export function PageHero({
  label,
  title,
  description,
  action,
}: {
  label: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-8">
      <div className="min-w-0">
        <div className="eyebrow flex items-center gap-3">
          <span className="h-px w-6 bg-[color:var(--color-hair-strong)]" aria-hidden />
          <span>{label}</span>
        </div>
        <h2 className="font-display mt-5 text-[40px] leading-[1.05] text-[color:var(--color-paper-50)] sm:text-[48px]">
          {title}
        </h2>
        {description && (
          <p className="mt-4 max-w-xl text-[14.5px] leading-[1.65] text-[color:var(--color-paper-300)]">
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
