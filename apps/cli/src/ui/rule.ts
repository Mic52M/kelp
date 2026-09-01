// Unicode section rules — the "━━ TARGET ━━━━━━" separators between
// output blocks. Width is capped at the terminal width (default 80).

import { c, hasColor } from "./style.js";

const TERM_WIDTH_DEFAULT = 80;

function width(): number {
  const w = process.stdout.columns;
  return typeof w === "number" && w > 0 ? Math.min(w, 96) : TERM_WIDTH_DEFAULT;
}

/** Full-width heavy rule. Used to open a top-level section. */
export function ruleHeavy(): string {
  return c.gray("━".repeat(width()));
}

/** Full-width thin rule. Used for sub-sections. */
export function ruleThin(): string {
  return c.gray("─".repeat(width()));
}

/** Rule with an embedded label: "━━ LABEL ━━━━━━━━" */
export function ruleLabel(label: string): string {
  const w = width();
  const prefix = "━━ ";
  const suffix = " ";
  const barLen = Math.max(0, w - prefix.length - label.length - suffix.length);
  const bar = "━".repeat(barLen);
  const line = `${prefix}${label}${suffix}${bar}`;
  return hasColor() ? c.gray(line) : line;
}

/** Timestamp helper — `[mm:ss.mmm]` since a reference epoch (usually
 *  scan start). Fixed width so log lines line up. */
export function timestamp(sinceMs: number): string {
  const d = Math.max(0, Date.now() - sinceMs);
  const totalMs = d % 1000;
  const totalS = Math.floor(d / 1000);
  const s = totalS % 60;
  const m = Math.floor(totalS / 60);
  return `[${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(totalMs).padStart(3, "0")}]`;
}
