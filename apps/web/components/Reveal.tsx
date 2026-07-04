// Reveal-on-scroll primitive. Detects when the child enters the viewport and
// applies the reveal animation. Restrained by default (16px lift + fade over
// 700ms), staggerable via `delay`. Follows prefers-reduced-motion: if the user
// asked for reduced motion, we show the content immediately without animation.

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

interface RevealProps {
  children: ReactNode;
  /** ms to wait after the element enters view before starting the animation */
  delay?: number;
  /** intersection ratio at which we trigger — lower = fires earlier */
  threshold?: number;
  /** extra classes appended to the wrapper */
  className?: string;
}

export function Reveal({ children, delay = 0, threshold = 0.15, className = "" }: RevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Respect the OS preference — no distracting motion for users who opt out.
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
      { threshold, rootMargin: "0px 0px -60px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return (
    <div
      ref={ref}
      style={{
        transitionDelay: visible ? `${delay}ms` : "0ms",
        willChange: "opacity, transform",
      }}
      className={`transition-all duration-700 ease-out ${
        visible ? "opacity-100 translate-y-0 blur-0" : "opacity-0 translate-y-4 blur-[2px]"
      } ${className}`}
    >
      {children}
    </div>
  );
}
