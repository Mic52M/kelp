import { CheckIcon, DotIcon } from "./icons";

export interface ConfigStep {
  label: string;
  done: boolean;
  anchor: string;
}

/**
 * Progress banner at the top of Configuration. Shows "X of N ready" plus a
 * horizontal step-list so the user always knows where they are. Anchor links
 * jump to the corresponding card. Non-sticky by design — pages that scroll
 * short benefit from anchoring the progress to the hero, not the viewport.
 */
export function ConfigProgress({ steps }: { steps: readonly ConfigStep[] }) {
  const done = steps.filter((s) => s.done).length;
  const total = steps.length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  const allDone = done === total;

  return (
    <div className="rounded-2xl border border-line/70 bg-ink-900/40 px-6 py-5">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-fog-500">
            Setup progress
          </div>
          <div className="mt-1 text-lg font-semibold tracking-tight text-fog-100">
            {allDone ? (
              <span className="text-aqua-300">Ready to scan</span>
            ) : (
              <>
                <span className="text-aqua-300">{done}</span>
                <span className="text-fog-500"> of </span>
                <span>{total}</span>
                <span className="text-fog-400"> steps done</span>
              </>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums text-fog-100">{percent}%</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-ink-800/70">
        <div
          className="h-full rounded-full bg-gradient-to-r from-aqua-500 to-aqua-300 transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Step chips */}
      <ol className="mt-4 grid gap-2 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.label}>
            <a
              href={s.anchor}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                s.done
                  ? "border-aqua-600/25 bg-aqua-500/[0.05] text-fog-200 hover:bg-aqua-500/[0.09]"
                  : "border-line/70 bg-ink-900/30 text-fog-300 hover:border-line hover:text-fog-100"
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                  s.done ? "bg-aqua-500/20 text-aqua-300" : "border border-line/80 text-fog-500"
                }`}
              >
                {s.done ? <CheckIcon className="h-3 w-3" /> : <DotIcon className="h-1.5 w-1.5" />}
              </span>
              <span className="flex-1 truncate">
                <span className="text-[10.5px] font-medium text-fog-500">Step {i + 1}</span>
                <span className="ml-1.5">{s.label}</span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}
