// Dynamic OG image for /r/<slug> (#33). Rendered via Next ImageResponse.
// This is the thumbnail that shows up on X, LinkedIn, iMessage previews.
// Editorial-industrial: dark ink, mono meta, big serif count, one accent dot.

import { ImageResponse } from "next/og";
import { getFreeScanBySlug } from "@kelp/worker";

export const runtime = "nodejs";
export const alt = "Kelp security report";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function shortRepo(u: string): string {
  return u.replace(/^https:\/\/github\.com\//, "");
}

export default async function OG({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const row = await getFreeScanBySlug(slug);
  const repo = row ? shortRepo(row.repoUrl) : "kelp report";
  const findings = Array.isArray(row?.findings) ? (row!.findings as { severity?: string }[]) : [];
  const counts = {
    critical: findings.filter((f) => f.severity === "critical").length,
    high: findings.filter((f) => f.severity === "high").length,
    medium: findings.filter((f) => f.severity === "medium").length,
    low: findings.filter((f) => f.severity === "low").length,
  };
  const total = findings.length;
  const serious = counts.critical + counts.high;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0A0B0C",
          color: "#F2EFE8",
          display: "flex",
          flexDirection: "column",
          padding: "72px 80px",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontFamily: "monospace",
            fontSize: 22,
            letterSpacing: 3,
            color: "#8B8A85",
            textTransform: "uppercase",
          }}
        >
          <span>KELP · Security report</span>
          <span>kelp.dev</span>
        </div>

        <div style={{ height: 2, background: "#232322", marginTop: 32, marginBottom: 56 }} />

        <div
          style={{
            display: "flex",
            fontFamily: "monospace",
            fontSize: 22,
            color: "#B7B5AC",
            letterSpacing: 2,
          }}
        >
          {repo}
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 20,
            fontSize: 108,
            lineHeight: 1,
            color: "#F2EFE8",
            fontWeight: 500,
          }}
        >
          {total} finding{total === 1 ? "" : "s"}
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 44,
            gap: 40,
            fontFamily: "monospace",
            fontSize: 26,
            color: "#D7D4CB",
          }}
        >
          {counts.critical > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 14, height: 14, background: "#A6E4B1", display: "block" }} />
              {counts.critical} critical
            </span>
          )}
          {counts.high > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 14, height: 14, background: "#A6E4B1", display: "block" }} />
              {counts.high} high
            </span>
          )}
          {counts.medium > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 14, height: 14, background: "#B7B5AC", display: "block" }} />
              {counts.medium} medium
            </span>
          )}
          {counts.low > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 14, height: 14, background: "#8B8A85", display: "block" }} />
              {counts.low} low
            </span>
          )}
          {total === 0 && (
            <span style={{ color: "#8B8A85" }}>No findings in coverage</span>
          )}
        </div>

        <div style={{ flex: 1 }} />

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            fontFamily: "monospace",
            fontSize: 22,
            color: "#8B8A85",
            letterSpacing: 2,
          }}
        >
          <span>{serious > 0 ? `${serious} serious · scanned by Kelp` : "scanned by Kelp"}</span>
          <span>kelp.dev/r/{slug}</span>
        </div>
      </div>
    ),
    size,
  );
}
