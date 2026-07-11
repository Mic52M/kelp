// Editorial severity distribution — a single hairline meter with segmented
// tone bands, plus a numeric legend. No pills, no colored bubbles.

interface Counts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  resolved: number;
}

const SEGMENTS = [
  { key: "critical", label: "Critical", short: "C", color: "var(--color-sev-crit)" },
  { key: "high",     label: "High",     short: "H", color: "var(--color-sev-high)" },
  { key: "medium",   label: "Medium",   short: "M", color: "var(--color-sev-med)"  },
  { key: "low",      label: "Low",      short: "L", color: "var(--color-sev-low)"  },
] as const;

export function SeverityMeter({ counts, hasScan }: { counts: Counts; hasScan: boolean }) {
  const activeTotal = counts.critical + counts.high + counts.medium + counts.low;

  return (
    <div className="w-full">
      <div className="flex h-[3px] w-full overflow-hidden bg-[color:var(--color-ink-800)]">
        {activeTotal === 0 ? (
          <div
            className="h-full w-full"
            style={{
              background: hasScan
                ? "var(--color-signal)"
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
                className="h-full"
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

      <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-5">
        {SEGMENTS.map((s) => (
          <LegendItem
            key={s.key}
            short={s.short}
            label={s.label}
            value={counts[s.key]}
            color={s.color}
          />
        ))}
        <LegendItem short="R" label="Resolved" value={counts.resolved} color="var(--color-signal-dim)" muted />
      </div>
    </div>
  );
}

function LegendItem({
  short,
  label,
  value,
  color,
  muted,
}: {
  short: string;
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
          className="font-mono text-[11px] tabular"
          style={{ color: active && !muted ? color : "var(--color-paper-500)" }}
        >
          {short}
        </span>
        <span
          className="font-display tabular text-[32px] leading-none"
          style={{ color: active && !muted ? "var(--color-paper-50)" : "var(--color-paper-400)" }}
        >
          {value}
        </span>
      </div>
      <div className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
        {label}
      </div>
    </div>
  );
}
