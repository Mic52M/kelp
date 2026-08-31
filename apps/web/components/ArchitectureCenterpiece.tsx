// Landing "big-thing" — Kelp's agent architecture in motion (§ 01).
//
// One SVG. Four specialists probe the connected repo in parallel. Findings
// emerge and flow to the reviewer, which drops the unreproducible ones and
// promotes the confirmed ones into the report panel. Loops every 12s.
//
// Design rules from [[web-design-anchor]]:
//   - No gradient, glass, aurora. Motion is structural (position, dash-
//     offset, opacity), never decorative (glow, particles, neon).
//   - Single signal accent — the same green as the rest of the site.
//   - Severity colours reused (crit/high/med/low) so the piece reads as
//     the same product, not a hero-only art piece.
//   - Respect prefers-reduced-motion — the CSS animations are wrapped in
//     `@media (prefers-reduced-motion: no-preference)` so a user who opts
//     out sees the final steady-state (all lines drawn, findings in the
//     report, no motion) instead of a jittering rush.
//
// Interactivity: hover over any labelled node to reveal its one-line role.
// Everything else is CSS-driven, so it stays cheap on the main thread.

"use client";

const AGENTS = [
  { key: "postgrest", label: "postgrest",   role: "Probes RLS + GRANTs on every table via the anon PostgREST surface.",  y: 70,  color: "var(--color-sev-med)"  },
  { key: "edge-fn",   label: "edge-fn",     role: "Lists every edge function, replays each without a JWT and inspects the response.", y: 170, color: "var(--color-signal)" },
  { key: "auth",      label: "auth",        role: "Reads supabase/config.toml + the auth flows for missing rate limits and open redirects.", y: 270, color: "var(--color-sev-high)" },
  { key: "secrets",   label: "secrets",     role: "Walks the source tree for hardcoded API keys, service-role JWTs, third-party secrets.", y: 370, color: "var(--color-sev-crit)" },
] as const;

// Findings that eventually appear in the report panel — order matches the
// arrival delays defined in the keyframes below. Each finding travels from
// its owning agent through the reviewer before landing in the panel.
const FINDINGS = [
  { severity: "critical", label: "VITE_SERVICE_ROLE in src/lib/db.ts:14",   from: "secrets"   },
  { severity: "high",     label: "get-order verify_jwt=false",              from: "edge-fn"   },
  { severity: "high",     label: "profiles.email — READ open to anon",      from: "postgrest" },
  { severity: "medium",   label: "reset flow missing rate-limit",           from: "auth"      },
] as const;

// Viewport constants — everything scales with these.
const W = 1120;
const H = 460;
const REPO_X = 420, REPO_Y = 175, REPO_W = 220, REPO_H = 110;
const REVIEWER_X = 745, REVIEWER_Y = 200, REVIEWER_W = 130, REVIEWER_H = 60;
const REPORT_X = 920, REPORT_Y = 60, REPORT_W = 180, REPORT_H = 340;

const SEV_COLOR: Record<string, string> = {
  critical: "var(--color-sev-crit)",
  high:     "var(--color-sev-high)",
  medium:   "var(--color-sev-med)",
  low:      "var(--color-paper-500)",
};

export function ArchitectureCenterpiece() {
  return (
    <div className="architecture-centerpiece relative w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Kelp agent architecture: four specialists probe the connected repository in parallel; findings flow through a reviewer that drops unreproducible leads and lands the confirmed ones in the report panel."
        className="w-full"
      >
        <defs>
          {/* Small marker used as the "finding" dot travelling along the wire. */}
          <symbol id="finding-dot" viewBox="-4 -4 8 8">
            <circle r="3" />
          </symbol>
        </defs>

        {/* Specialist → repo probe lines. Each has a stroke-dashoffset animation
            keyed by --i so they draw in sequence, then reset every cycle. */}
        {AGENTS.map((a, i) => (
          <g key={a.key} className="probe" style={{ ["--i" as string]: i }}>
            <line
              x1={180}
              y1={a.y}
              x2={REPO_X}
              y2={REPO_Y + 20 + i * 24}
              stroke={a.color}
              strokeWidth={1}
              strokeDasharray="4 6"
              className="probe-line"
              opacity={0.85}
            />
          </g>
        ))}

        {/* Trunk from repo → reviewer. Constant hairline. */}
        <line
          x1={REPO_X + REPO_W}
          y1={REPO_Y + REPO_H / 2}
          x2={REVIEWER_X}
          y2={REVIEWER_Y + REVIEWER_H / 2}
          stroke="var(--color-hair-strong)"
          strokeWidth={1}
        />

        {/* Reviewer → report. */}
        <line
          x1={REVIEWER_X + REVIEWER_W}
          y1={REVIEWER_Y + REVIEWER_H / 2}
          x2={REPORT_X}
          y2={REPORT_Y + 40}
          stroke="var(--color-hair-strong)"
          strokeWidth={1}
        />

        {/* Specialists (left column). */}
        {AGENTS.map((a) => (
          <g key={a.key} className="node" tabIndex={0} role="button" aria-label={`${a.label}: ${a.role}`}>
            <rect
              x={70}
              y={a.y - 22}
              width={110}
              height={44}
              fill="transparent"
              stroke={a.color}
              strokeWidth={1}
            />
            <text
              x={125}
              y={a.y + 5}
              textAnchor="middle"
              fontFamily="var(--font-mono, ui-monospace, monospace)"
              fontSize={12}
              fill={a.color}
            >
              [{a.label}]
            </text>
            {/* Tooltip: rendered as HTML-in-foreignObject so it inherits
                the site typography and wraps like body copy. */}
            <foreignObject
              x={-10}
              y={a.y + 26}
              width={220}
              height={90}
              className="node-tooltip"
            >
              <div className="pointer-events-none border-l border-[color:var(--color-hair-strong)] pl-3 font-mono text-[10.5px] leading-relaxed text-[color:var(--color-paper-300)]">
                {a.role}
              </div>
            </foreignObject>
          </g>
        ))}

        {/* Target repo (centre). */}
        <g className="node">
          <rect
            x={REPO_X}
            y={REPO_Y}
            width={REPO_W}
            height={REPO_H}
            fill="none"
            stroke="var(--color-paper-500)"
            strokeWidth={1}
          />
          <text
            x={REPO_X + REPO_W / 2}
            y={REPO_Y + 30}
            textAnchor="middle"
            fontFamily="var(--font-mono, ui-monospace, monospace)"
            fontSize={10.5}
            fill="var(--color-paper-500)"
            letterSpacing="1.5"
          >
            ◇ TARGET
          </text>
          <text
            x={REPO_X + REPO_W / 2}
            y={REPO_Y + 60}
            textAnchor="middle"
            fontFamily="var(--font-mono, ui-monospace, monospace)"
            fontSize={14}
            fill="var(--color-paper-100)"
          >
            roamly-app
          </text>
          <text
            x={REPO_X + REPO_W / 2}
            y={REPO_Y + 82}
            textAnchor="middle"
            fontFamily="var(--font-mono, ui-monospace, monospace)"
            fontSize={11}
            fill="var(--color-paper-500)"
          >
            supabase + edge fns
          </text>
        </g>

        {/* Reviewer. */}
        <g className="node">
          <rect
            x={REVIEWER_X}
            y={REVIEWER_Y}
            width={REVIEWER_W}
            height={REVIEWER_H}
            fill="none"
            stroke="var(--color-signal-dim)"
            strokeWidth={1}
          />
          <text
            x={REVIEWER_X + REVIEWER_W / 2}
            y={REVIEWER_Y + 24}
            textAnchor="middle"
            fontFamily="var(--font-mono, ui-monospace, monospace)"
            fontSize={11}
            fill="var(--color-signal)"
          >
            reviewer
          </text>
          <text
            x={REVIEWER_X + REVIEWER_W / 2}
            y={REVIEWER_Y + 42}
            textAnchor="middle"
            fontFamily="var(--font-mono, ui-monospace, monospace)"
            fontSize={10}
            fill="var(--color-paper-500)"
          >
            re-runs · gates
          </text>
        </g>

        {/* Report panel — findings arrive here at staggered delays. */}
        <g className="report">
          <rect
            x={REPORT_X}
            y={REPORT_Y}
            width={REPORT_W}
            height={REPORT_H}
            fill="var(--color-ink-900)"
            stroke="var(--color-hair-strong)"
            strokeWidth={1}
          />
          <text
            x={REPORT_X + 16}
            y={REPORT_Y + 26}
            fontFamily="var(--font-mono, ui-monospace, monospace)"
            fontSize={10}
            fill="var(--color-paper-500)"
            letterSpacing="1.5"
          >
            § REPORT
          </text>
          <line
            x1={REPORT_X + 12}
            y1={REPORT_Y + 38}
            x2={REPORT_X + REPORT_W - 12}
            y2={REPORT_Y + 38}
            stroke="var(--color-hair)"
          />
          {FINDINGS.map((f, i) => (
            <g key={i} className="report-item" style={{ ["--i" as string]: i }}>
              <circle
                cx={REPORT_X + 18}
                cy={REPORT_Y + 60 + i * 46}
                r={2.5}
                fill={SEV_COLOR[f.severity]}
              />
              <text
                x={REPORT_X + 30}
                y={REPORT_Y + 55 + i * 46}
                fontFamily="var(--font-mono, ui-monospace, monospace)"
                fontSize={9}
                fill="var(--color-paper-500)"
                letterSpacing="1"
              >
                {f.severity.toUpperCase()}
              </text>
              <text
                x={REPORT_X + 18}
                y={REPORT_Y + 72 + i * 46}
                fontFamily="var(--font-mono, ui-monospace, monospace)"
                fontSize={10}
                fill="var(--color-paper-100)"
              >
                {truncate(f.label, 22)}
              </text>
            </g>
          ))}
        </g>

        {/* Findings-in-flight — one per finding, travelling repo → reviewer →
            report. Delays are keyed via --i so they arrive in the same
            cadence as the report items reveal. */}
        {FINDINGS.map((f, i) => {
          const agent = AGENTS.find((a) => a.key === f.from);
          const color = SEV_COLOR[f.severity];
          return (
            <g key={i} className="in-flight" style={{ ["--i" as string]: i, color }}>
              <use
                href="#finding-dot"
                fill={color}
                className="dot dot-a"
                style={{ ["--from-x" as string]: `${180}px`, ["--from-y" as string]: `${agent?.y}px` }}
              />
              <use
                href="#finding-dot"
                fill={color}
                className="dot dot-b"
              />
            </g>
          );
        })}
      </svg>

      <style>{`
        .architecture-centerpiece .node-tooltip {
          opacity: 0;
          transition: opacity 220ms ease;
          pointer-events: none;
        }
        .architecture-centerpiece .node:hover .node-tooltip,
        .architecture-centerpiece .node:focus-visible .node-tooltip {
          opacity: 1;
        }
        .architecture-centerpiece .node:focus-visible rect {
          outline: 1px solid var(--color-signal);
          outline-offset: 2px;
        }
        .architecture-centerpiece .node text,
        .architecture-centerpiece .node rect {
          transition: opacity 220ms ease;
        }
        .architecture-centerpiece .node:hover rect,
        .architecture-centerpiece .node:hover text {
          opacity: 1;
        }

        /* Steady state — reduced-motion sees this, nothing else. */
        .architecture-centerpiece .probe-line { stroke-dasharray: 4 6; }
        .architecture-centerpiece .in-flight .dot { opacity: 0; }
        .architecture-centerpiece .report-item { opacity: 1; }

        @media (prefers-reduced-motion: no-preference) {
          .architecture-centerpiece .probe-line {
            stroke-dashoffset: 400;
            animation: kelp-probe 12s linear infinite;
            animation-delay: calc(var(--i) * 0.4s);
          }
          @keyframes kelp-probe {
            0%    { stroke-dashoffset: 400; opacity: 0; }
            3%    { opacity: 0.85; }
            15%   { stroke-dashoffset: 0;   opacity: 0.85; }
            55%   { stroke-dashoffset: 0;   opacity: 0.85; }
            65%   { stroke-dashoffset: -400; opacity: 0; }
            100%  { stroke-dashoffset: -400; opacity: 0; }
          }

          /* dot-a travels from the agent to the reviewer. */
          .architecture-centerpiece .in-flight .dot-a {
            animation: kelp-fly-a 12s linear infinite;
            animation-delay: calc(1.6s + var(--i) * 0.6s);
          }
          @keyframes kelp-fly-a {
            0%   { transform: translate(180px, var(--from-y, 220px)); opacity: 0; }
            5%   { opacity: 1; }
            20%  { transform: translate(${REPO_X + REPO_W / 2}px, ${REPO_Y + REPO_H / 2}px); opacity: 1; }
            35%  { transform: translate(${REVIEWER_X + REVIEWER_W / 2}px, ${REVIEWER_Y + REVIEWER_H / 2}px); opacity: 1; }
            40%  { transform: translate(${REVIEWER_X + REVIEWER_W / 2}px, ${REVIEWER_Y + REVIEWER_H / 2}px); opacity: 0; }
            100% { transform: translate(${REVIEWER_X + REVIEWER_W / 2}px, ${REVIEWER_Y + REVIEWER_H / 2}px); opacity: 0; }
          }

          /* dot-b travels reviewer → report row. */
          .architecture-centerpiece .in-flight .dot-b {
            animation: kelp-fly-b 12s linear infinite;
            animation-delay: calc(2.4s + var(--i) * 0.6s);
          }
          @keyframes kelp-fly-b {
            0%   { transform: translate(${REVIEWER_X + REVIEWER_W}px, ${REVIEWER_Y + REVIEWER_H / 2}px); opacity: 0; }
            5%   { opacity: 1; }
            50%  { transform: translate(${REPORT_X + 18}px, calc(${REPORT_Y + 60}px + var(--i) * 46px)); opacity: 1; }
            55%  { opacity: 0; }
            100% { transform: translate(${REPORT_X + 18}px, calc(${REPORT_Y + 60}px + var(--i) * 46px)); opacity: 0; }
          }

          /* Report rows fade in staggered to match the dot arrivals. */
          .architecture-centerpiece .report-item {
            opacity: 0;
            animation: kelp-row 12s linear infinite;
            animation-delay: calc(2.9s + var(--i) * 0.6s);
          }
          @keyframes kelp-row {
            0%   { opacity: 0; transform: translateX(4px); }
            3%   { opacity: 1; transform: translateX(0); }
            80%  { opacity: 1; }
            90%  { opacity: 0; }
            100% { opacity: 0; }
          }
        }
      `}</style>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
