import type { BackendMap, BackendMapColumn, BackendMapEntry } from "@/lib/data";
import type { Severity } from "@/lib/types";

// "Backend map" (#44) — editorial, text-first discovery view of what Kelp sees
// for the connected project. All data comes from `projects.backend_report`
// (migration 0011) + finding evidence surfaces (#43). No graph library, no
// fake data: an unanalyzed project renders a hairline placeholder.

const SEV_COLOR: Record<Severity, string> = {
  critical: "var(--color-sev-crit)",
  high: "var(--color-sev-high)",
  medium: "var(--color-sev-med)",
  low: "var(--color-sev-low)",
};

export function BackendMapPanel({ map }: { map: BackendMap }) {
  if (!map.analyzed) {
    return (
      <section className="mt-16">
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
          § Backend map
        </div>
        <h2 className="font-display mt-3 text-[30px] leading-[1.1] text-[color:var(--color-paper-50)]">
          What Kelp sees.
        </h2>
        <div className="mt-6 border border-dashed border-[color:var(--color-hair)] px-6 py-12">
          <p className="max-w-xl text-[13.5px] leading-[1.65] text-[color:var(--color-paper-400)]">
            Kelp hasn&rsquo;t analyzed this project&rsquo;s backend yet. Once the first
            scan runs, this panel will show the repo, Supabase, and auth
            surfaces Kelp is testing.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-16">
      <div className="flex items-baseline justify-between gap-6">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
            § Backend map
          </div>
          <h2 className="font-display mt-3 text-[30px] leading-[1.1] text-[color:var(--color-paper-50)]">
            What Kelp sees.
          </h2>
        </div>
        {map.primary && (
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
            Primary · {map.primary.type} · {map.primary.confidence} confidence
          </span>
        )}
      </div>
      <p className="mt-4 max-w-2xl text-[13.5px] leading-[1.65] text-[color:var(--color-paper-400)]">
        The concrete surfaces Kelp is testing on your app. Each row is proven —
        it appeared verbatim in your repo or in the analyzer&rsquo;s output.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-px border border-[color:var(--color-hair)] bg-[color:var(--color-hair)] md:grid-cols-3">
        {map.columns.map((col) => (
          <Column key={col.kind} col={col} />
        ))}
      </div>

      {(map.hints.length > 0 || map.warnings.length > 0) && (
        <div className="mt-6 space-y-2">
          {map.warnings.map((w) => (
            <Note key={`w-${w}`} kind="warning" text={w} />
          ))}
          {map.hints.map((h) => (
            <Note key={`h-${h}`} kind="hint" text={h} />
          ))}
        </div>
      )}
    </section>
  );
}

function Column({ col }: { col: BackendMapColumn }) {
  return (
    <div className="bg-[color:var(--color-ink)] px-5 py-5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor: col.worstSeverity
                ? SEV_COLOR[col.worstSeverity]
                : "var(--color-hair-strong)",
            }}
            aria-hidden
          />
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
            {col.heading}
          </div>
        </div>
        <span className="font-mono tabular text-[11px] text-[color:var(--color-paper-500)]">
          {col.findingCount === 0
            ? "clear"
            : `${col.findingCount} finding${col.findingCount === 1 ? "" : "s"}`}
        </span>
      </div>
      <p className="mt-2 text-[12.5px] leading-[1.55] text-[color:var(--color-paper-400)]">
        {col.lede}
      </p>
      <ul className="mt-4 space-y-3">
        {col.entries.map((e, i) => (
          <li key={`${col.kind}-${i}-${e.label}`}>
            <Entry entry={e} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Entry({ entry }: { entry: BackendMapEntry }) {
  return (
    <div>
      <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
        {entry.severityDot && (
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: SEV_COLOR[entry.severityDot] }}
            aria-hidden
          />
        )}
        {entry.label}
      </div>
      <div className="mt-1 break-all font-mono text-[12.5px] leading-[1.65] text-[color:var(--color-paper-100)]">
        {entry.value}
      </div>
      {entry.note && (
        <div className="mt-0.5 font-mono text-[10.5px] tracking-[0.06em] text-[color:var(--color-paper-500)]">
          {entry.note}
        </div>
      )}
    </div>
  );
}

function Note({ kind, text }: { kind: "hint" | "warning"; text: string }) {
  const color = kind === "warning" ? "var(--color-sev-med)" : "var(--color-paper-500)";
  const label = kind === "warning" ? "!" : "·";
  return (
    <div
      className="flex items-start gap-3 border-l px-4 py-2.5 text-[13px] leading-relaxed"
      style={{ borderColor: color }}
    >
      <span className="font-mono" style={{ color }} aria-hidden>
        {label}
      </span>
      <span className="text-[color:var(--color-paper-200)]">{text}</span>
    </div>
  );
}
