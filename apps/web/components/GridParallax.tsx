// Fine grid background that scrolls slightly slower than the page — a subtle
// parallax that gives the surface depth without ever calling attention to
// itself. Falls back to a static grid when the user prefers reduced motion.

"use client";

import { useEffect, useRef } from "react";

export function GridParallax() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let ticking = false;
    const update = () => {
      // The grid moves at 40% of the scroll speed — barely there, but the eye
      // reads it as "layered behind" the content.
      el.style.transform = `translate3d(0, ${window.scrollY * -0.4}px, 0)`;
      ticking = false;
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return <div ref={ref} className="grid-texture absolute inset-0 will-change-transform" />;
}
