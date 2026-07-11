// Severity as a typographic annotation, not a colored pill.
// A single monospace letter + the label in mono caps + a hairline tick in the
// severity tone. Reads like a wire-service classifier, not a status bubble.

import type { Severity } from "@/lib/types";

const MAP: Record<Severity, { letter: string; label: string; color: string }> = {
  critical: { letter: "C", label: "Critical", color: "var(--color-sev-crit)" },
  high:     { letter: "H", label: "High",     color: "var(--color-sev-high)" },
  medium:   { letter: "M", label: "Medium",   color: "var(--color-sev-med)"  },
  low:      { letter: "L", label: "Low",      color: "var(--color-sev-low)"  },
};

export function SeverityBadge({
  severity,
  size = "md",
}: {
  severity: Severity;
  size?: "sm" | "md";
}) {
  const s = MAP[severity];
  const isSm = size === "sm";
  return (
    <span
      className="inline-flex items-center gap-2 font-mono uppercase tabular"
      style={{ fontSize: isSm ? 10 : 11, letterSpacing: "0.14em" }}
    >
      <span
        className="inline-block"
        style={{
          width: 2,
          height: isSm ? 10 : 12,
          background: s.color,
        }}
        aria-hidden
      />
      <span style={{ color: s.color }}>{s.letter}</span>
      <span className="text-[color:var(--color-paper-400)]">{s.label}</span>
    </span>
  );
}
