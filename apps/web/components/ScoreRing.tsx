// Security posture score rendered as a display-serif number with a hairline
// meter beneath it. Replaces the previous circular ring — this reads like an
// editorial data point instead of a dashboard gauge.

export function ScoreRing({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <div className="w-full max-w-[280px]">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
          Posture · not scanned
        </div>
        <div className="mt-3 flex items-baseline gap-3">
          <span className="font-display tabular text-[64px] leading-none text-[color:var(--color-paper-500)]">
            —
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
            / 100
          </span>
        </div>
        <div className="mt-6 h-px w-full bg-[color:var(--color-hair)]" />
      </div>
    );
  }

  const clamped = Math.max(0, Math.min(100, score));
  const color =
    clamped >= 75
      ? "var(--color-sev-ok)"
      : clamped >= 50
        ? "var(--color-sev-med)"
        : "var(--color-sev-crit)";

  return (
    <div className="w-full max-w-[280px]">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
        Posture · out of 100
      </div>
      <div className="mt-3 flex items-baseline gap-3">
        <span
          className="font-display tabular text-[80px] leading-none"
          style={{ color }}
        >
          {clamped}
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
          / 100
        </span>
      </div>
      <div className="mt-6 h-px w-full bg-[color:var(--color-hair)]">
        <div
          className="h-px"
          style={{
            width: `${clamped}%`,
            background: color,
            transition: "width 800ms cubic-bezier(0.2,0,0,1)",
          }}
        />
      </div>
    </div>
  );
}
