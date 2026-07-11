// Status marker rendered as a mono chip with a leading tick, editorial anchor.
// done · needed · optional — differentiated by tone only, never a colored bubble.

export function StatusPill({
  status,
  label,
}: {
  status: "done" | "needed" | "optional";
  label?: string;
}) {
  const map = {
    done: {
      color: "var(--color-signal)",
      text: label ?? "Ready",
    },
    needed: {
      color: "var(--color-sev-high)",
      text: label ?? "Needed",
    },
    optional: {
      color: "var(--color-paper-500)",
      text: label ?? "Optional",
    },
  } as const;
  const s = map[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em]"
      style={{ color: s.color }}
    >
      <span
        className="inline-block"
        style={{
          width: 2,
          height: 8,
          background: s.color,
        }}
        aria-hidden
      />
      {s.text}
    </span>
  );
}
