// Kelp mark. A single hairline glyph — two vertical strokes (kelp fronds)
// intersecting a horizontal water line. No gradient, no shield, no glow.
// Wordmark uses the display serif for a distinctive, "publication" feel.

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg
        width="16"
        height="20"
        viewBox="0 0 16 20"
        fill="none"
        stroke="currentColor"
        aria-hidden
        className="text-[color:var(--color-paper-50)]"
      >
        {/* water line */}
        <path d="M0.5 12 H15.5" strokeWidth="1" />
        {/* left frond */}
        <path
          d="M5 19 C 5 15, 3.2 12, 5 8 C 6.2 5.4, 5.8 3, 4 1"
          strokeWidth="1.1"
          strokeLinecap="round"
          fill="none"
        />
        {/* right frond */}
        <path
          d="M11 19 C 11 15, 12.8 12, 11 8 C 9.8 5.4, 10.2 3, 12 1"
          strokeWidth="1.1"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      <span
        className="font-display text-[19px] leading-none tracking-tight text-[color:var(--color-paper-50)]"
        style={{ fontVariationSettings: '"opsz" 96' }}
      >
        Kelp
      </span>
    </span>
  );
}
