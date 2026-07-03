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
    <header className="flex items-center gap-4 border-b border-line/70 px-6 py-3.5">
      <h1 className="text-sm font-medium text-fog-50">{title}</h1>
      <div className="ml-auto flex items-center gap-3">
        {action}
        {email && <span className="hidden text-xs text-fog-400 sm:inline">{email}</span>}
        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-aqua-500 to-violet-500" />
      </div>
    </header>
  );
}
