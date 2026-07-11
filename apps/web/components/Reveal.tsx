// Reveal-on-scroll primitive — opacity + 8px lift over 500ms. No blur (dated,
// cheap-feeling). Respects prefers-reduced-motion. Staggerable via `delay`.

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

interface RevealProps {
  children: ReactNode;
  /** ms to wait after the element enters view before starting the animation */
  delay?: number;
  /** intersection ratio at which we trigger — lower = fires earlier */
  threshold?: number;
  /** initial y offset in pixels (default 8) */
  y?: number;
  /** total duration in ms (default 520) */
  duration?: number;
  className?: string;
}

export function Reveal({
  children,
  delay = 0,
  threshold = 0.12,
  y = 8,
  duration = 520,
  className = "",
}: RevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
          }
        }
      },
      { threshold, rootMargin: "0px 0px -40px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return (
    <div
      ref={ref}
      style={{
        transitionDelay: visible ? `${delay}ms` : "0ms",
        transitionDuration: `${duration}ms`,
        transform: visible ? "translateY(0)" : `translateY(${y}px)`,
        opacity: visible ? 1 : 0,
        willChange: "opacity, transform",
      }}
      className={`transition-all ease-[cubic-bezier(0.2,0,0,1)] ${className}`}
    >
      {children}
    </div>
  );
}
