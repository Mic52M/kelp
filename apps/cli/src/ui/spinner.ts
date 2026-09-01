// Braille spinner for long-running phases (file walk, big scans, agent
// think time). Non-blocking, cancellable, and TTY-only — a piped stdout
// or NO_COLOR run just prints the label once and skips the animation.

import { c, hasColor } from "./style.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 80;

export interface Spinner {
  update(label: string): void;
  stop(finalLabel?: string, status?: "ok" | "fail" | "warn"): void;
}

export function spinner(initialLabel: string): Spinner {
  // Non-TTY / CI: print once, no animation, no cursor tricks.
  if (!process.stderr.isTTY || !hasColor()) {
    process.stderr.write(`  · ${initialLabel}\n`);
    return {
      update() {},
      stop(finalLabel) {
        if (finalLabel) process.stderr.write(`  · ${finalLabel}\n`);
      },
    };
  }

  let label = initialLabel;
  let frame = 0;
  let stopped = false;

  const draw = () => {
    if (stopped) return;
    // \r brings the cursor back to column 0; \x1b[K clears to end of line
    // so a shorter label doesn't leave the tail of the previous one behind.
    process.stderr.write(`\r\x1b[K  ${c.kelp(FRAMES[frame]!)} ${label}`);
    frame = (frame + 1) % FRAMES.length;
  };

  draw();
  const timer = setInterval(draw, INTERVAL_MS);
  // Never keep the event loop alive because of the spinner.
  timer.unref();

  return {
    update(next: string) {
      label = next;
    },
    stop(finalLabel?: string, status: "ok" | "fail" | "warn" = "ok") {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      const glyph = status === "ok" ? c.green("✓") : status === "fail" ? c.red("✗") : c.yellow("⚠");
      const text = finalLabel ?? label;
      process.stderr.write(`\r\x1b[K  ${glyph} ${text}\n`);
    },
  };
}
