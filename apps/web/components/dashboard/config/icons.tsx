// Tiny inline SVG set for the Configuration cards. Kept in one file so the
// aesthetic (1.5px stroke, rounded caps/joins, 20px viewBox) stays consistent
// no matter which card imports them.

const base = {
  viewBox: "0 0 20 20",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function CheckIcon({
  className = "h-4 w-4",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg {...base} className={className} style={style} aria-hidden>
      <path d="m4.5 10.5 3.5 3.5L15.5 6" />
    </svg>
  );
}

export function CircleIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...base} className={className} aria-hidden>
      <circle cx="10" cy="10" r="6.5" />
    </svg>
  );
}

export function DotIcon({ className = "h-2 w-2" }: { className?: string }) {
  return (
    <svg viewBox="0 0 8 8" className={className} aria-hidden>
      <circle cx="4" cy="4" r="4" fill="currentColor" />
    </svg>
  );
}

export function ArrowRightIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...base} className={className} aria-hidden>
      <path d="M4 10h12M11 5l5 5-5 5" />
    </svg>
  );
}

export function ShieldIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...base} className={className} aria-hidden>
      <path d="M10 2.5 4 4.5v5c0 3.6 2.6 6.6 6 8 3.4-1.4 6-4.4 6-8v-5l-6-2Z" />
      <path d="m7.5 10 2 2 3-4" />
    </svg>
  );
}

export function UsersIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...base} className={className} aria-hidden>
      <circle cx="7.5" cy="7" r="2.5" />
      <path d="M3 15c.5-2.5 2.5-4 4.5-4s4 1.5 4.5 4" />
      <circle cx="14" cy="8" r="2" />
      <path d="M12 15c.4-1.8 2-3 3.5-3S18 13 18 15" />
    </svg>
  );
}

export function DatabaseIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...base} className={className} aria-hidden>
      <ellipse cx="10" cy="4.5" rx="6" ry="2" />
      <path d="M4 4.5v11c0 1.1 2.7 2 6 2s6-.9 6-2v-11" />
      <path d="M4 10c0 1.1 2.7 2 6 2s6-.9 6-2" />
    </svg>
  );
}

export function ChevronDownIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...base} className={className} aria-hidden>
      <path d="m6 8 4 4 4-4" />
    </svg>
  );
}

export function InfoIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...base} className={className} aria-hidden>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 9v4M10 6.5v.5" />
    </svg>
  );
}

export function CopyIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...base} className={className} aria-hidden>
      <rect x="7" y="7" width="9" height="9" rx="1.5" />
      <path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" />
    </svg>
  );
}

export function ExternalIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg {...base} className={className} aria-hidden>
      <path d="M9 5H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-3" />
      <path d="M12 4h4v4M16 4l-7 7" />
    </svg>
  );
}
