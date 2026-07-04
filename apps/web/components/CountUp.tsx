// Animated integer count-up. Fires when the element enters the viewport,
// eases to `to` over `duration` ms. Formats via a caller-provided template so
// "62" can display as "45–62%" while still animating the number.

"use client";

import { useEffect, useRef, useState } from "react";

// Format names cover the shapes the landing needs. Prefer these over passing a
// function prop — landing is a Server Component and functions cross the RSC
// boundary only via a "use server" export.
export type CountUpFormat =
  | "plain"           // 12345
  | "commas"          // 12,345
  | "plus"            // 12,345+
  | "percent"         // 42%
  | "rangeUpToPct"    // 45–{n}%
  | "lessThanMin";    // < 10 min

function render(n: number, kind: CountUpFormat): string {
  switch (kind) {
    case "plain": return n.toString();
    case "commas": return n.toLocaleString();
    case "plus": return `${n.toLocaleString()}+`;
    case "percent": return `${n}%`;
    case "rangeUpToPct": return `45–${n}%`;
    case "lessThanMin": return `< ${n} min`;
  }
}

interface CountUpProps {
  to: number;
  duration?: number;
  /** how to render the current value; default: plain integer */
  format?: CountUpFormat;
  className?: string;
}

export function CountUp({ to, duration = 1400, format = "plain", className = "" }: CountUpProps) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [value, setValue] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setValue(to);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !started.current) {
            started.current = true;
            const start = performance.now();
            const tick = (now: number) => {
              const t = Math.min(1, (now - start) / duration);
              // easeOutCubic — dramatic-but-natural landing
              const eased = 1 - Math.pow(1 - t, 3);
              setValue(Math.round(to * eased));
              if (t < 1) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [to, duration]);

  return (
    <span ref={ref} className={className}>
      {render(value, format)}
    </span>
  );
}
