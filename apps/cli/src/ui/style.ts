// Color + text-styling primitives. TTY-aware and NO_COLOR-respectful — piping
// to a file or a CI log strips every ANSI escape automatically. Keeps
// downstream tooling (grep, jq, humans reading log files) sane.
//
// colorEnabled() below is the single place that decides whether escapes are
// emitted; every helper here gates on it and no other module reads NO_COLOR
// or stdout.isTTY for styling.

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

export interface ColorInputs {
  /** Explicit `--no-color` on the command line. */
  noColorFlag?: boolean;
  /** Typically `process.env`; injected so tests never touch the real one. */
  env?: { NO_COLOR?: string | undefined };
  /** Typically `process.stdout.isTTY === true`. */
  isTty?: boolean;
}

// Precedence: --no-color > NO_COLOR > TTY. The NO_COLOR spec treats the env
// var as a user-level default ("should override $NO_COLOR" is the per-instance
// command-line wording), so the flag is checked first. Either opt-out wins;
// color only ever turns on for an interactive stdout. NO_COLOR="" counts as
// unset, per the spec.
export function colorEnabled(inputs: ColorInputs = {}): boolean {
  const {
    noColorFlag = false,
    env = process.env,
    isTty = process.stdout.isTTY === true,
  } = inputs;
  if (noColorFlag) return false;
  if (env.NO_COLOR) return false;
  return isTty;
}

// Resolved from argv by index.ts before any output is rendered.
let noColorFlag = false;

export function setNoColorFlag(on: boolean): void {
  noColorFlag = on;
}

function ttyOn(): boolean {
  return colorEnabled({ noColorFlag });
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
