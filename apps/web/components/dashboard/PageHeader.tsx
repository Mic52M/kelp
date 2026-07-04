// Minimal top-bar shown on every dashboard subpage. Just utility chrome — the
// page's real hero (big heading + label) lives inside the page body so it gets
// the same weight as Overview.
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
    <header className="flex items-center gap-4 border-b border-line/70 px-8 py-4">
      <h1 className="text-[13px] font-medium uppercase tracking-[0.14em] text-fog-500">
        {title}
      </h1>
      <div className="ml-auto flex items-center gap-3">
        {action}
        {email && <span className="hidden text-xs text-fog-400 sm:inline">{email}</span>}
        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-aqua-500 to-violet-500" />
      </div>
    </header>
  );
}

// Big page hero used at the top of each dashboard subpage body. Same visual
// register as the Overview title so the app reads as one product.
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
      <div>
        <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-fog-500">
          {label}
        </div>
        <h2 className="text-4xl font-semibold tracking-tight sm:text-[42px]">{title}</h2>
        {description && (
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-fog-300">
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
