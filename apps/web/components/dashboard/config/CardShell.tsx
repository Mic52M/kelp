import type { ReactNode } from "react";
import { StatusPill } from "./StatusPill";

/**
 * Shared shell for the three primary Configuration cards. Ensures the same
 * hierarchy (icon → title → status pill → description → body) so scanning
 * the page feels consistent. Cards get an `id` for anchor navigation from
 * the progress banner.
 */
export function CardShell({
  id,
  step,
  icon,
  title,
  description,
  status,
  statusLabel,
  headerRight,
  children,
}: {
  id?: string;
  step: number;
  icon: ReactNode;
  title: string;
  description: ReactNode;
  status: "done" | "needed" | "optional";
  statusLabel?: string;
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-20 rounded-2xl border border-line/70 bg-ink-900/40"
    >
      <header className="flex items-start gap-4 border-b border-line/60 px-6 py-5">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
            status === "done"
              ? "bg-aqua-500/12 text-aqua-300"
              : status === "needed"
                ? "bg-amber-500/12 text-amber-300"
                : "bg-ink-800/70 text-fog-400"
          }`}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10.5px] font-medium uppercase tracking-[0.14em] text-fog-500">
            Step {step}
          </div>
          <div className="mt-0.5 flex items-center gap-3">
            <h2 className="text-lg font-semibold tracking-tight text-fog-100">{title}</h2>
            <StatusPill status={status} label={statusLabel} />
          </div>
          <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-fog-400">
            {description}
          </p>
        </div>
        {headerRight && <div className="shrink-0">{headerRight}</div>}
      </header>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}
