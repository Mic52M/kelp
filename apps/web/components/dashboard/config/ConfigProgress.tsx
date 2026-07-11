export interface ConfigStep {
  label: string;
  done: boolean;
  anchor: string;
}

/**
 * Progress meter at the top of Configuration. "X of N ready" plus per-step
 * anchors. Editorial anchor: hairline shell, mono eyebrow, Fraunces count,
 * a single-pixel signal fill on the meter.
 */
export function ConfigProgress({ steps }: { steps: readonly ConfigStep[] }) {
  const done = steps.filter((s) => s.done).length;
  const total = steps.length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  const allDone = done === total;

  return (
    <div className="border border-[color:var(--color-hair)] px-6 py-5">
      <div className="flex items-baseline justify-between gap-6">
        <div className="min-w-0">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
            § Setup progress
          </div>
          <div className="mt-2 flex items-baseline gap-3 font-display text-[26px] leading-[1.1] text-[color:var(--color-paper-50)]">
            {allDone ? (
              <span style={{ color: "var(--color-signal)" }}>Ready to scan</span>
            ) : (
              <>
                <span className="tabular">{done}</span>
                <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
                  of
                </span>
                <span className="tabular">{total}</span>
                <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-[color:var(--color-paper-400)]">
                  steps done
                </span>
              </>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-display tabular text-[30px] leading-none text-[color:var(--color-paper-50)]">
            {percent}%
          </div>
        </div>
      </div>

      <div className="mt-5 h-px w-full bg-[color:var(--color-ink-800)]">
        <div
          className="h-px"
          style={{
            width: `${percent}%`,
            background: "var(--color-signal)",
            transition: "width 600ms cubic-bezier(0.2,0,0,1)",
          }}
        />
      </div>

      <ol className="mt-6 grid gap-3 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.label}>
            <a
              href={s.anchor}
              className="flex items-center gap-3 border px-3 py-2.5 transition-colors"
              style={{
                borderColor: s.done
                  ? "var(--color-signal-dim)"
                  : "var(--color-hair)",
              }}
            >
              <span
                className="inline-block"
                style={{
                  width: 2,
                  height: 12,
                  background: s.done
                    ? "var(--color-signal)"
                    : "var(--color-paper-600)",
                }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">
                <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
                  Step {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  className="mt-1 block text-[13px]"
                  style={{
                    color: s.done ? "var(--color-paper-50)" : "var(--color-paper-300)",
                  }}
                >
                  {s.label}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}
