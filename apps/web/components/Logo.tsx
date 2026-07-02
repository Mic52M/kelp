export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden>
        <defs>
          <linearGradient id="kelp-g" x1="0" y1="0" x2="32" y2="32">
            <stop stopColor="var(--color-aqua-400)" />
            <stop offset="1" stopColor="var(--color-violet-400)" />
          </linearGradient>
        </defs>
        {/* shield outline */}
        <path
          d="M16 2.5 27 6.4v9.1c0 6.6-4.4 11.7-11 14-6.6-2.3-11-7.4-11-14V6.4L16 2.5Z"
          stroke="url(#kelp-g)"
          strokeWidth="1.6"
          opacity="0.5"
        />
        {/* kelp fronds */}
        <path
          d="M13 23c-1.2-4 .3-7.5 0-10.5-.2-2 .6-3.4 2-4.5"
          stroke="url(#kelp-g)"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
        <path
          d="M19 23c1.2-4-.3-7.5 0-10.5.2-2-.6-3.4-2-4.5"
          stroke="url(#kelp-g)"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
      </svg>
      <span className="text-[17px] font-semibold tracking-tight">Kelp</span>
    </span>
  );
}
