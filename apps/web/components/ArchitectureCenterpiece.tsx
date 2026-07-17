// Landing § 01 — Kelp's agent architecture as an orchestrated diagram.
//
// The animation is a single 12s coordinated sequence, not scattered effects:
// four specialists take turns, each completing the full arc (probe → target
// flash → return beam in severity colour → reviewer flash → report row) before
// the next one starts. The one that gets dropped by the reviewer never lands
// a row — that's the "reviewer keeps the honest ones" story made visible.
//
// Design rules from [[web-design-anchor]] and the frontend-design skill:
//   - Orchestrate, don't scatter — one beat at a time.
//   - Motion teaches the structure. Nothing is decorative.
//   - No glow, no glass, no gradient. Just stroke, dasharray, opacity.
//   - Single accent (signal green) + severity palette for the "confirmed"
//     leg. Grey when idle.
//   - prefers-reduced-motion sees the steady state.
//
// Interactivity: hover any specialist to reveal a one-line role via
// foreignObject tooltip.

"use client";

interface Specialist {
  key: "postgrest" | "edge-fn" | "auth" | "secrets";
  label: string;
  role: string;
  finding: string;
  severity: "critical" | "high" | "medium" | "low";
  dropped?: boolean;
  y: number;
  color: string;
}

const SPECIALISTS: Specialist[] = [
  {
    key: "postgrest",
    label: "postgrest",
    role: "Probes RLS + GRANTs on every table via the anon PostgREST surface.",
    finding: "profiles.email — READ open to anon",
    severity: "high",
    y: 60,
    color: "var(--color-sev-med)",
  },
  {
    key: "edge-fn",
    label: "edge-fn",
    role: "Lists every edge function and replays each without a JWT.",
    finding: "get-order verify_jwt=false",
    severity: "critical",
    y: 160,
    color: "var(--color-signal)",
  },
  {
    key: "auth",
    label: "auth",
    role: "Reads supabase/config.toml + auth flows for missing rate-limits.",
    finding: "reset flow lead — not reproducible",
    severity: "medium",
    dropped: true,
    y: 260,
    color: "var(--color-sev-high)",
  },
  {
    key: "secrets",
    label: "secrets",
    role: "Walks the source tree for hardcoded API keys and service-role JWTs.",
    finding: "VITE_SERVICE_ROLE in src/lib/db.ts:14",
    severity: "critical",
    y: 360,
    color: "var(--color-sev-crit)",
  },
];

const SEV_COLOR: Record<Specialist["severity"], string> = {
  critical: "var(--color-sev-crit)",
  high: "var(--color-sev-high)",
  medium: "var(--color-sev-med)",
  low: "var(--color-paper-500)",
};

// Geometry. Everything else is expressed in these constants so the layout
// stays legible.
const W = 1120;
const H = 460;
const SP_X = 60, SP_W = 130, SP_H = 60;
const TARGET_X = 340, TARGET_Y = 180, TARGET_W = 220, TARGET_H = 100;
const REVIEWER_X = 660, REVIEWER_Y = 200, REVIEWER_W = 130, REVIEWER_H = 60;
const REPORT_X = 830, REPORT_Y = 40, REPORT_W = 260, REPORT_H = 380;

// One 12s cycle. Each specialist owns a 2.4s slice; the last 2.4s is a hold
// on the finished report before the loop restarts. `--i` shifts the shared
// keyframes into each specialist's window.
const CYCLE_MS = 12000;

export function ArchitectureCenterpiece() {
  const rows = SPECIALISTS.filter((s) => !s.dropped);

  return (
    <div className="architecture-centerpiece relative w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Kelp agent architecture: four specialists take turns probing the connected repository. Each finding is re-run by the reviewer; unreproducible leads are dropped, confirmed ones land in the report."
        className="w-full"
      >
        {/* ── SPECIALISTS ────────────────────────────────────────────────── */}
        {SPECIALISTS.map((s, i) => {
          const cy = s.y + SP_H / 2;
          return (
            <g
              key={s.key}
              className="node specialist"
              style={{ ["--i" as string]: i }}
              tabIndex={0}
              role="button"
              aria-label={`${s.label}: ${s.role}`}
            >
              {/* Static rest state — always visible so the diagram is readable
                  even mid-animation. Bright pulse comes from the overlay below. */}
              <rect
                x={SP_X}
                y={s.y}
                width={SP_W}
                height={SP_H}
                fill="none"
                stroke={s.color}
                strokeWidth={1}
                opacity={0.35}
              />
              <text
                x={SP_X + SP_W / 2}
                y={s.y + 24}
                textAnchor="middle"
                fontFamily="var(--font-mono, ui-monospace, monospace)"
                fontSize={12}
                fill={s.color}
                opacity={0.55}
              >
                [{s.label}]
              </text>
              <text
                x={SP_X + SP_W / 2}
                y={s.y + 42}
                textAnchor="middle"
                fontFamily="var(--font-mono, ui-monospace, monospace)"
                fontSize={9.5}
                fill="var(--color-paper-500)"
                letterSpacing="1.2"
              >
                {s.severity.toUpperCase()}
              </text>
              {/* Active-beat overlay — full opacity when it's this
                  specialist's turn, fades otherwise. */}
              <rect
                className="specialist-active"
                x={SP_X}
                y={s.y}
                width={SP_W}
                height={SP_H}
                fill="none"
                stroke={s.color}
                strokeWidth={1.2}
              />
              <text
                className="specialist-active-label"
                x={SP_X + SP_W / 2}
                y={s.y + 24}
                textAnchor="middle"
                fontFamily="var(--font-mono, ui-monospace, monospace)"
                fontSize={12}
                fill={s.color}
              >
                [{s.label}]
              </text>

              {/* Hover tooltip. */}
              <foreignObject
                x={SP_X - 6}
                y={s.y + SP_H + 6}
                width={SP_W + 60}
                height={72}
                className="node-tooltip"
              >
                <div className="pointer-events-none border-l border-[color:var(--color-hair-strong)] pl-3 font-mono text-[10.5px] leading-relaxed text-[color:var(--color-paper-300)]">
                  {s.role}
                </div>
              </foreignObject>

              {/* Outbound beam — specialist → target. Draws in the specialist
                  colour, fades once target flashes. */}
              <line
                className="beam beam-out"
                x1={SP_X + SP_W}
                y1={cy}
                x2={TARGET_X}
                y2={TARGET_Y + 25 + i * 15}
                stroke={s.color}
                strokeWidth={1.25}
                strokeLinecap="round"
              />

              {/* Return beam — target → reviewer. Drawn in the SEVERITY colour
                  because now the finding has a class. Skipped by dropped ones
                  via CSS (opacity 0 for the .dropped variant). */}
              <line
                className={"beam beam-return" + (s.dropped ? " dropped" : "")}
                x1={TARGET_X + TARGET_W}
                y1={TARGET_Y + TARGET_H / 2}
                x2={REVIEWER_X}
                y2={REVIEWER_Y + REVIEWER_H / 2}
                stroke={SEV_COLOR[s.severity]}
                strokeWidth={1.25}
                strokeLinecap="round"
              />

              {/* Target flash — same rect drawn brighter, animated in only
                  during this specialist's beat. */}
              <rect
                className="target-flash"
                x={TARGET_X - 1}
                y={TARGET_Y - 1}
                width={TARGET_W + 2}
                height={TARGET_H + 2}
                fill="none"
                stroke={s.color}
                strokeWidth={1.5}
              />

              {/* Reviewer flash. */}
              <rect
                className={"reviewer-flash" + (s.dropped ? " dropped" : "")}
                x={REVIEWER_X - 1}
                y={REVIEWER_Y - 1}
                width={REVIEWER_W + 2}
                height={REVIEWER_H + 2}
                fill="none"
                stroke={s.dropped ? "var(--color-paper-500)" : SEV_COLOR[s.severity]}
                strokeWidth={1.5}
              />
            </g>
          );
        })}

        {/* ── STATIC WIRE HINTS (visible always, muted) ─────────────────── */}
        {SPECIALISTS.map((s, i) => (
          <line
            key={`hint-${s.key}`}
            x1={SP_X + SP_W}
            y1={s.y + SP_H / 2}
            x2={TARGET_X}
            y2={TARGET_Y + 25 + i * 15}
            stroke="var(--color-hair-strong)"
            strokeWidth={0.5}
            strokeDasharray="1 4"
          />
        ))}
        <line
          x1={TARGET_X + TARGET_W}
          y1={TARGET_Y + TARGET_H / 2}
          x2={REVIEWER_X}
          y2={REVIEWER_Y + REVIEWER_H / 2}
          stroke="var(--color-hair-strong)"
          strokeWidth={0.5}
          strokeDasharray="1 4"
        />
        <line
          x1={REVIEWER_X + REVIEWER_W}
          y1={REVIEWER_Y + REVIEWER_H / 2}
          x2={REPORT_X}
          y2={REPORT_Y + 50}
          stroke="var(--color-hair-strong)"
          strokeWidth={0.5}
          strokeDasharray="1 4"
        />

        {/* ── TARGET (rest state) ────────────────────────────────────────── */}
        <g className="node target-node">
          <rect
            x={TARGET_X}
            y={TARGET_Y}
            width={TARGET_W}
            height={TARGET_H}
            fill="none"
            stroke="var(--color-paper-500)"
            strokeWidth={1}
          />
          <text
            x={TARGET_X + TARGET_W / 2}
            y={TARGET_Y + 28}
            textAnchor="middle"
            fontFamily="var(--font-mono, ui-monospace, monospace)"
            fontSize={10.5}
            fill="var(--color-paper-500)"
            letterSpacing="1.5"
          >
            ◇ TARGET
          </text>
          <text
            x={TARGET_X + TARGET_W / 2}
            y={TARGET_Y + 58}
            textAnchor="middle"
            fontFamily="var(--font-mono, ui-monospace, monospace)"
            fontSize={16}
            fill="var(--color-paper-50)"
          >
            roamly-app
          </text>
          <text
            x={TARGET_X + TARGET_W / 2}
            y={TARGET_Y + 80}
            textAnchor="middle"
            fontFamily="var(--font-mono, ui-monospace, monospace)"
            fontSize={11}
            fill="var(--color-paper-500)"
          >
            supabase + edge fns
          </text>
        </g>

        {/* ── REVIEWER ───────────────────────────────────────────────────── */}
        <g className="node reviewer-node">
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
            fontSize={11.5}
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

        {/* ── REPORT PANEL ───────────────────────────────────────────────── */}
        <g className="report-panel">
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
            x={REPORT_X + 18}
            y={REPORT_Y + 28}
            fontFamily="var(--font-mono, ui-monospace, monospace)"
            fontSize={10.5}
            fill="var(--color-paper-500)"
            letterSpacing="1.5"
          >
            § REPORT
          </text>
          <text
            x={REPORT_X + REPORT_W - 18}
            y={REPORT_Y + 28}
            textAnchor="end"
            fontFamily="var(--font-mono, ui-monospace, monospace)"
            fontSize={10}
            fill="var(--color-paper-500)"
          >
            {rows.length} confirmed · {SPECIALISTS.length - rows.length} dropped
          </text>
          <line
            x1={REPORT_X + 14}
            y1={REPORT_Y + 42}
            x2={REPORT_X + REPORT_W - 14}
            y2={REPORT_Y + 42}
            stroke="var(--color-hair)"
          />

          {rows.map((s, i) => (
            <g
              key={s.key}
              className="report-row"
              style={{ ["--i" as string]: SPECIALISTS.findIndex((x) => x.key === s.key) }}
            >
              <circle
                cx={REPORT_X + 22}
                cy={REPORT_Y + 70 + i * 62}
                r={3}
                fill={SEV_COLOR[s.severity]}
              />
              <text
                x={REPORT_X + 34}
                y={REPORT_Y + 65 + i * 62}
                fontFamily="var(--font-mono, ui-monospace, monospace)"
                fontSize={9.5}
                fill="var(--color-paper-500)"
                letterSpacing="1.2"
              >
                {s.severity.toUpperCase()}
              </text>
              <text
                x={REPORT_X + 22}
                y={REPORT_Y + 84 + i * 62}
                fontFamily="var(--font-mono, ui-monospace, monospace)"
                fontSize={11}
                fill="var(--color-paper-100)"
              >
                {truncate(s.finding, 30)}
              </text>
              <text
                x={REPORT_X + 22}
                y={REPORT_Y + 102 + i * 62}
                fontFamily="var(--font-mono, ui-monospace, monospace)"
                fontSize={9.5}
                fill="var(--color-paper-500)"
              >
                via [{s.key}]
              </text>
            </g>
          ))}
        </g>
      </svg>

      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
    </div>
  );
}

const STYLES = `
        .architecture-centerpiece .node-tooltip {
          opacity: 0;
          transition: opacity 220ms ease;
          pointer-events: none;
        }
        .architecture-centerpiece .specialist:hover .node-tooltip,
        .architecture-centerpiece .specialist:focus-visible .node-tooltip {
          opacity: 1;
        }
        .architecture-centerpiece .specialist:focus-visible rect:first-of-type {
          outline: 1px solid var(--color-signal);
          outline-offset: 2px;
        }

        /* Steady state — visible under reduced-motion, hidden otherwise
           until the beat comes around. */
        .architecture-centerpiece .specialist-active,
        .architecture-centerpiece .specialist-active-label,
        .architecture-centerpiece .beam,
        .architecture-centerpiece .target-flash,
        .architecture-centerpiece .reviewer-flash {
          opacity: 0;
        }
        .architecture-centerpiece .report-row { opacity: 1; }

        /* Beam line prep. Real dasharray gets computed at runtime from the
           stroke length; the drawn-length trick uses pathLength instead so
           we can talk in %. Setting pathLength lets us dasharray "100"
           regardless of actual pixel length. */
        .architecture-centerpiece .beam {
          pathLength: 100;
          stroke-dasharray: 100;
          stroke-dashoffset: 100;
        }

        @media (prefers-reduced-motion: no-preference) {
          /* Sequential beat: each specialist owns a 2.4s slice, delay = i × 2.4s. */
          .architecture-centerpiece .specialist-active,
          .architecture-centerpiece .specialist-active-label {
            animation: kelp-active 12s linear infinite;
            animation-delay: calc(var(--i) * 2.4s);
          }
          @keyframes kelp-active {
            0%   { opacity: 0; }
            2%   { opacity: 1; }
            20%  { opacity: 1; }
            22%  { opacity: 0; }
            100% { opacity: 0; }
          }

          /* Outbound beam draws in the first 40% of the slice. */
          .architecture-centerpiece .beam-out {
            animation: kelp-beam-out 12s linear infinite;
            animation-delay: calc(var(--i) * 2.4s);
          }
          @keyframes kelp-beam-out {
            0%   { stroke-dashoffset: 100; opacity: 0; }
            1%   { opacity: 1; }
            8%   { stroke-dashoffset: 0; opacity: 1; }
            13%  { opacity: 1; }
            16%  { opacity: 0; }
            100% { stroke-dashoffset: 0; opacity: 0; }
          }

          /* Target flashes when the outbound beam arrives. */
          .architecture-centerpiece .target-flash {
            animation: kelp-flash 12s linear infinite;
            animation-delay: calc(var(--i) * 2.4s + 0.6s);
          }
          @keyframes kelp-flash {
            0%   { opacity: 0; }
            5%   { opacity: 1; }
            15%  { opacity: 0.4; }
            25%  { opacity: 0; }
            100% { opacity: 0; }
          }

          /* Return beam draws in the second half of the slice. */
          .architecture-centerpiece .beam-return {
            animation: kelp-beam-return 12s linear infinite;
            animation-delay: calc(var(--i) * 2.4s + 0.7s);
          }
          .architecture-centerpiece .beam-return.dropped {
            /* dropped leads never make it past the reviewer — the return
               beam plays a short fade instead of a full draw. */
            animation: kelp-beam-dropped 12s linear infinite;
            animation-delay: calc(var(--i) * 2.4s + 0.7s);
          }
          @keyframes kelp-beam-return {
            0%   { stroke-dashoffset: 100; opacity: 0; }
            1%   { opacity: 1; }
            10%  { stroke-dashoffset: 0; opacity: 1; }
            15%  { opacity: 1; }
            18%  { opacity: 0; }
            100% { stroke-dashoffset: 0; opacity: 0; }
          }
          @keyframes kelp-beam-dropped {
            0%   { stroke-dashoffset: 100; opacity: 0; }
            1%   { opacity: 0.6; }
            5%   { stroke-dashoffset: 50; opacity: 0.6; }
            10%  { stroke-dashoffset: 65; opacity: 0; }
            100% { opacity: 0; }
          }

          /* Reviewer flash — one per specialist. Colour comes from the
             severity in the inline stroke attr. */
          .architecture-centerpiece .reviewer-flash {
            animation: kelp-flash 12s linear infinite;
            animation-delay: calc(var(--i) * 2.4s + 1.4s);
          }

          /* Report row appears when the reviewer confirms. Rows persist —
             opacity goes back to 0 only at the very end of the cycle so the
             report is legible while filling up. */
          .architecture-centerpiece .report-row {
            opacity: 0;
            transform: translateX(6px);
            animation: kelp-row 12s linear infinite;
            animation-delay: calc(var(--i) * 2.4s + 1.6s);
            transform-box: fill-box;
          }
          @keyframes kelp-row {
            0%, 12% { opacity: 0; transform: translateX(6px); }
            15%     { opacity: 1; transform: translateX(0); }
            88%     { opacity: 1; }
            96%     { opacity: 0; }
            100%    { opacity: 0; }
          }
        }
`;

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
