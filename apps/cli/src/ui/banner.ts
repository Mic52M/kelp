// Small ASCII banner printed at the top of `kelp scan`. Deliberately
// four lines and change — enough to say "this is a real tool" without
// screen-eating vanity ASCII. Colour is the same kelp signal green as
// the rest of the site.

import { c, hasColor } from "./style.js";

export function banner(version: string, subtitle?: string): string {
  // Two-line wordmark. Uses block characters that render everywhere
  // (macOS Terminal, iTerm, Windows Terminal, GitHub Actions log).
  const lines = [
    "  ██╗  ██╗███████╗██╗     ██████╗ ",
    "  ██║ ██╔╝██╔════╝██║     ██╔══██╗",
    "  █████╔╝ █████╗  ██║     ██████╔╝",
    "  ██╔═██╗ ██╔══╝  ██║     ██╔═══╝ ",
    "  ██║  ██╗███████╗███████╗██║     ",
    "  ╚═╝  ╚═╝╚══════╝╚══════╝╚═╝     ",
  ];
  const wordmark = hasColor() ? lines.map((l) => c.kelp(l)).join("\n") : lines.join("\n");
  const tag = subtitle ? `  ${c.dim(subtitle)}` : "";
  const ver = `  ${c.dim(`v${version}  ·  security scanner for vibe-coded apps  ·  MIT`)}`;
  return `\n${wordmark}\n${ver}\n${tag ? tag + "\n" : ""}`;
}
