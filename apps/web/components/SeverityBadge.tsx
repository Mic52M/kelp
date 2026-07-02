import type { Severity } from "@/lib/types";

const MAP: Record<Severity, { label: string; color: string; dot: string }> = {
  critical: { label: "Critical", color: "text-[color:var(--color-crit)]", dot: "bg-[color:var(--color-crit)]" },
  high: { label: "High", color: "text-[color:var(--color-high)]", dot: "bg-[color:var(--color-high)]" },
  medium: { label: "Medium", color: "text-[color:var(--color-med)]", dot: "bg-[color:var(--color-med)]" },
  low: { label: "Low", color: "text-[color:var(--color-low)]", dot: "bg-[color:var(--color-low)]" },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const s = MAP[severity];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-line/80 bg-ink-800/60 px-2.5 py-0.5 text-xs font-medium ${s.color}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
