// Color + text-styling primitives. TTY-aware and NO_COLOR-respectful — piping
// to a file or a CI log strips every ANSI escape automatically. Keeps
// downstream tooling (grep, jq, humans reading log files) sane.

const RESET = "\x1b[0m";

// Foreground
export const FG_RED = "\x1b[31m";
export const FG_GREEN = "\x1b[32m";
export const FG_YELLOW = "\x1b[33m";
export const FG_BLUE = "\x1b[34m";
export const FG_MAGENTA = "\x1b[35m";
export const FG_CYAN = "\x1b[36m";
export const FG_WHITE = "\x1b[37m";
export const FG_GRAY = "\x1b[90m";

// Background — for severity chips.
export const BG_RED = "\x1b[41m";
export const BG_YELLOW = "\x1b[43m";
export const BG_BLUE = "\x1b[44m";
export const BG_GRAY = "\x1b[100m";
export const BG_GREEN_DIM = "\x1b[42;2m";

// Text modifiers
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";
export const ITALIC = "\x1b[3m";
export const UNDERLINE = "\x1b[4m";

// Kelp signal (approx. #b8f2c9 — the same green used everywhere else).
export const KELP = "\x1b[38;2;184;242;201m";

function ttyOn(): boolean {
  return process.stdout.isTTY === true && !process.env.NO_COLOR;
}

export function paint(s: string, ...codes: string[]): string {
  if (!ttyOn()) return s;
  return `${codes.join("")}${s}${RESET}`;
}

export const c = {
  bold: (s: string) => paint(s, BOLD),
  dim: (s: string) => paint(s, DIM),
  italic: (s: string) => paint(s, ITALIC),
  red: (s: string) => paint(s, FG_RED),
  green: (s: string) => paint(s, FG_GREEN),
  yellow: (s: string) => paint(s, FG_YELLOW),
  blue: (s: string) => paint(s, FG_BLUE),
  cyan: (s: string) => paint(s, FG_CYAN),
  gray: (s: string) => paint(s, FG_GRAY),
  kelp: (s: string) => paint(s, KELP, BOLD),
};

/** True if the current stdout supports ANSI. */
export function hasColor(): boolean {
  return ttyOn();
}
