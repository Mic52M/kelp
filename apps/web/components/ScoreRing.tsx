/**
 * Circular security-posture score, 0–100. Color shifts red → amber → aqua.
 * A `null` score means "no successful scan yet — we don't know", rendered as
 * a muted "—" instead of a misleading 100. Anything else is a real score.
 */
export function ScoreRing({ score }: { score: number | null }) {
  const r = 46;
  const circ = 2 * Math.PI * r;

  if (score === null) {
    return (
      <div className="relative h-32 w-32 shrink-0">
        <svg viewBox="0 0 110 110" className="h-full w-full">
          <circle
            cx="55"
            cy="55"
            r={r}
            fill="none"
            stroke="var(--color-ink-700)"
            strokeWidth="8"
            strokeDasharray="4 6"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-semibold text-fog-500">—</span>
          <span className="text-[11px] text-fog-500">no scan yet</span>
        </div>
      </div>
    );
  }

  const clamped = Math.max(0, Math.min(100, score));
  const dash = (clamped / 100) * circ;
  const color =
    clamped >= 75 ? "var(--color-ok)" : clamped >= 50 ? "var(--color-med)" : "var(--color-crit)";

  return (
    <div className="relative h-32 w-32 shrink-0">
      <svg viewBox="0 0 110 110" className="h-full w-full -rotate-90">
        <circle cx="55" cy="55" r={r} fill="none" stroke="var(--color-ink-700)" strokeWidth="8" />
        <circle
          cx="55"
          cy="55"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          style={{ transition: "stroke-dasharray 1s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold" style={{ color }}>
          {clamped}
        </span>
        <span className="text-[11px] text-fog-400">/ 100</span>
      </div>
    </div>
  );
}
