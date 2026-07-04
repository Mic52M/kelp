// A subtle aqua glow that follows the cursor across the hero. The heavy motion
// libraries (Framer, GSAP) are overkill for this — a single mousemove listener
// updating two CSS variables gives the same feel with zero bundle cost.
// Disabled on touch/coarse pointers where "hover" doesn't apply.

"use client";

import { useEffect, useRef } from "react";

export function HeroSpotlight() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Skip on touch devices — the spotlight would just sit inert in the corner.
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let rafId = 0;
    let x = 0;
    let y = 0;
    let queued = false;

    const flush = () => {
      queued = false;
      el.style.setProperty("--mx", `${x}px`);
      el.style.setProperty("--my", `${y}px`);
      el.style.opacity = "1";
    };

    const move = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
      if (!queued) {
        queued = true;
        rafId = requestAnimationFrame(flush);
      }
    };

    const leave = () => {
      el.style.opacity = "0";
    };

    window.addEventListener("mousemove", move, { passive: true });
    window.addEventListener("mouseleave", leave);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseleave", leave);
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500"
      style={{
        background:
          "radial-gradient(500px circle at var(--mx, 50%) var(--my, 30%), rgba(52, 230, 207, 0.12), transparent 55%)",
      }}
    />
  );
}
