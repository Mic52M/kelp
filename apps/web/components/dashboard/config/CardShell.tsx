import type { ReactNode } from "react";
import { StatusPill } from "./StatusPill";

/**
 * Shared shell for Configuration cards. Editorial anchor — hairline border,
 * mono eyebrow, Fraunces title, StatusPill inline. Anchor id preserved for
 * the progress banner jumps.
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
      className="scroll-mt-24 border border-[color:var(--color-hair)] bg-transparent"
    >
      <header className="flex items-start gap-5 border-b border-[color:var(--color-hair)] px-6 py-5">
        <div
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border"
          style={{
            borderColor:
              status === "done"
                ? "var(--color-signal-dim)"
                : status === "needed"
                  ? "var(--color-sev-high)"
                  : "var(--color-hair-strong)",
            color:
              status === "done"
                ? "var(--color-signal)"
                : status === "needed"
                  ? "var(--color-sev-high)"
                  : "var(--color-paper-400)",
          }}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
            § Step {String(step).padStart(2, "0")}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h2 className="font-display text-[22px] leading-[1.15] text-[color:var(--color-paper-50)]">
              {title}
            </h2>
            <StatusPill status={status} label={statusLabel} />
          </div>
          <p className="mt-3 max-w-xl text-[13.5px] leading-[1.65] text-[color:var(--color-paper-400)]">
            {description}
          </p>
        </div>
        {headerRight && <div className="shrink-0">{headerRight}</div>}
      </header>
      <div className="px-6 py-6">{children}</div>
    </section>
  );
}
