// Segmented severity distribution + legend for the Overview hero. Reads like
// Linear/Sentry's issue-mix bars: a single proportional bar plus a clean
// legend. When there are no active findings it shows a calm "all clear" state.

interface Counts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  resolved: number;
}

const SEGMENTS = [
  { key: "critical", label: "Critical", color: "var(--color-crit)" },
  { key: "high", label: "High", color: "var(--color-high)" },
  { key: "medium", label: "Medium", color: "var(--color-med)" },
  { key: "low", label: "Low", color: "var(--color-low)" },
] as const;

export function SeverityMeter({ counts, hasScan }: { counts: Counts; hasScan: boolean }) {
  const activeTotal = counts.critical + counts.high + counts.medium + counts.low;

  return (
    <div className="w-full">
      {/* The bar */}
      <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-ink-800/70">
        {activeTotal === 0 ? (
          <div
            className="h-full w-full rounded-full"
            style={{
              background: hasScan
                ? "linear-gradient(90deg, var(--color-aqua-600), var(--color-aqua-400))"
                : "var(--color-ink-700)",
            }}
          />
        ) : (
          SEGMENTS.map((s) => {
            const n = counts[s.key];
            if (n === 0) return null;
            return (
              <div
                key={s.key}
                className="h-full rounded-sm transition-all"
                style={{
                  width: `${(n / activeTotal) * 100}%`,
                  backgroundColor: s.color,
                }}
                title={`${n} ${s.label}`}
              />
            );
          })
        )}
      </div>

      {/* Legend */}
      <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-5">
        {SEGMENTS.map((s) => (
          <LegendItem key={s.key} label={s.label} value={counts[s.key]} color={s.color} />
        ))}
        <LegendItem label="Resolved" value={counts.resolved} color="var(--color-aqua-500)" muted />
      </div>
    </div>
  );
}

function LegendItem({
  label,
  value,
  color,
  muted,
}: {
  label: string;
  value: number;
  color: string;
  muted?: boolean;
}) {
  const active = value > 0;
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: active ? color : "var(--color-ink-600)" }}
        />
        <span
          className="text-2xl font-semibold tabular-nums"
          style={{ color: active && !muted ? color : "var(--color-fog-400)" }}
        >
          {value}
        </span>
      </div>
      <div className="mt-1 pl-4 text-[11px] uppercase tracking-wider text-fog-500">{label}</div>
    </div>
  );
}
