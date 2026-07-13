// GET /r/<slug>/badge — SVG badge for READMEs (#33).
//
// shields.io-style but in Kelp's editorial-industrial palette. Two labels:
// "Scanned by Kelp" · "<N findings>" (or "· clean" when 0).

import { getFreeScanBySlug } from "@kelp/worker";

export const runtime = "nodejs";

const INK = "#0A0B0C";
const PAPER = "#F2EFE8";
const SIGNAL = "#A6E4B1";
const HAIR = "#232322";

function esc(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]!);
}

// Rough monospace character width at 11px — good enough for a badge.
function w(text: string): number {
  return Math.ceil(text.length * 6.4) + 14;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await ctx.params;
  const row = /^[a-z0-9]{6,20}$/.test(slug) ? await getFreeScanBySlug(slug) : null;

  const total = row && Array.isArray(row.findings) ? row.findings.length : 0;
  const status =
    !row ? "unknown"
      : total === 0 ? "clean"
      : `${total} finding${total === 1 ? "" : "s"}`;

  const leftLabel = "Scanned by Kelp";
  const rightLabel = status;
  const leftW = w(leftLabel);
  const rightW = w(rightLabel);
  const totalW = leftW + rightW;
  const rightBg = status === "clean" || status === "unknown" ? HAIR : SIGNAL;
  const rightFg = rightBg === SIGNAL ? INK : PAPER;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="22" viewBox="0 0 ${totalW} 22" role="img" aria-label="${esc(leftLabel)}: ${esc(rightLabel)}">
  <rect width="${leftW}" height="22" fill="${INK}"/>
  <rect x="${leftW}" width="${rightW}" height="22" fill="${rightBg}"/>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11" text-rendering="geometricPrecision">
    <text x="${leftW / 2}" y="15" text-anchor="middle" fill="${PAPER}">${esc(leftLabel)}</text>
    <text x="${leftW + rightW / 2}" y="15" text-anchor="middle" fill="${rightFg}">${esc(rightLabel)}</text>
  </g>
</svg>`;

  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300",
    },
  });
}
