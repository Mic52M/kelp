import type { TimeToFixStats } from "@/lib/data";
import type { Severity } from "@/lib/types";

// "Median time to fix" tile (#35). Editorial-industrial: single mono number,
// per-severity breakdown row. Powers the pitch metric — closes the loop
// against a hired pentester's multi-day turnaround.

const SEV_COLOR: Record<Severity, string> = {
  critical: "var(--color-sev-crit)",
  high: "var(--color-sev-high)",
  medium: "var(--color-sev-med)",
  low: "var(--color-sev-low)",
};

export function TimeToFixTile({ stats }: { stats: TimeToFixStats | null }) {
  if (!stats) return <EmptyTile />;

  return (
    <section className="mt-14 border border-[color:var(--color-hair)] px-6 py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
            § Median time to fix
          </div>
          <div className="mt-3 flex items-baseline gap-3">
            <span className="font-display text-[44px] leading-none text-[color:var(--color-paper-50)] tabular">
              {formatDuration(stats.overallMs)}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
              across {stats.sampleSize} closed{" "}
              {stats.sampleSize === 1 ? "finding" : "findings"}
            </span>
          </div>
        </div>
        <p className="max-w-sm text-[12.5px] leading-[1.65] text-[color:var(--color-paper-400)]">
          From first detected to closed — auto-verified after a push, or
          marked resolved by you. Lower is better.
        </p>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(["critical", "high", "medium", "low"] as const).map((sev) => (
          <SeverityRow key={sev} sev={sev} ms={stats.bySeverity[sev]} />
        ))}
      </div>
    </section>
  );
}

function SeverityRow({ sev, ms }: { sev: Severity; ms: number | null }) {
  return (
    <div className="border-l pl-3" style={{ borderColor: SEV_COLOR[sev] }}>
      <div
        className="font-mono text-[10px] uppercase tracking-[0.14em]"
        style={{ color: SEV_COLOR[sev] }}
      >
        {sev}
      </div>
      <div className="mt-1 font-display text-[20px] leading-tight text-[color:var(--color-paper-100)] tabular">
        {ms === null ? "—" : formatDuration(ms)}
      </div>
    </div>
  );
}

function EmptyTile() {
  return (
    <section className="mt-14 border border-dashed border-[color:var(--color-hair)] px-6 py-6">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
        § Median time to fix
      </div>
      <p className="mt-3 max-w-md text-[13px] leading-[1.65] text-[color:var(--color-paper-400)]">
        No findings closed yet. Once a fix lands (either auto-verified after a
        push, or marked resolved by you), the median lands here.
      </p>
    </section>
  );
}

/** ms → "12s" / "8m" / "3.2h" / "2.5d". Kept intentionally coarse — the
 *  pitch is "minutes on Kelp vs days elsewhere," not sub-second precision. */
function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) {
    const h = ms / 3_600_000;
    return h < 10 ? `${h.toFixed(1)}h` : `${Math.round(h)}h`;
  }
  const d = ms / 86_400_000;
  return d < 10 ? `${d.toFixed(1)}d` : `${Math.round(d)}d`;
}
