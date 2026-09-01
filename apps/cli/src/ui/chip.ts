// Severity chip — small colored pill (e.g. "▐ CRITICAL ▐"). Uses left/right
// half-blocks so it reads like a real chip in a terminal even without a
// background-color escape. When ANSI is on we ALSO paint the interior with
// bold+coloured foreground so it stands out at a glance.

import { c, hasColor, paint, BOLD, FG_RED, FG_YELLOW, FG_BLUE, FG_GRAY } from "./style.js";
import type { Severity } from "@kelp/core";

const LEFT = "▐";
const RIGHT = "▌";

const SEV_FG: Record<Severity, string> = {
  critical: FG_RED,
  high: FG_YELLOW,
  medium: FG_BLUE,
  low: FG_GRAY,
};

const SEV_LABEL: Record<Severity, string> = {
  critical: "CRITICAL",
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
};

/** Fixed-width severity chip suitable for stacking in a table.
 *  Width is always 12 columns regardless of severity length. */
export function severityChip(sev: Severity): string {
  const label = SEV_LABEL[sev];
  const pad = " ".repeat(Math.max(0, 8 - label.length));
  const inner = ` ${label}${pad} `;
  if (!hasColor()) return `[${label.padEnd(8)}]`;
  const color = SEV_FG[sev];
  return `${paint(LEFT, color)}${paint(inner, color, BOLD)}${paint(RIGHT, color)}`;
}

/** OK / FAIL / WARN inline chip (for report status, not findings). */
export function statusChip(kind: "ok" | "fail" | "warn" | "skip"): string {
  const map = {
    ok:   { icon: "✓", text: " ok  ",   fg: c.green },
    fail: { icon: "✗", text: " fail",   fg: c.red },
    warn: { icon: "⚠", text: " warn",   fg: c.yellow },
    skip: { icon: "○", text: " skip",   fg: c.gray },
  } as const;
  const m = map[kind];
  return `${m.fg(m.icon)} ${m.fg(m.text)}`;
}
