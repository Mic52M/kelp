import Link from "next/link";
import { CheckIcon, ArrowRightIcon } from "./icons";

/**
 * Bottom banner that transitions with the user's progress. Two states:
 *
 *  · Complete — full-width aqua CTA "Run active pen test → Overview", cheering
 *    the user through the finish line.
 *  · Incomplete — subtle rundown of what's still needed, with anchors to jump
 *    back to each unfinished step. Keeps context on ONE screen so the user
 *    doesn't have to hunt.
 */
export function ReadyBanner({
  ready,
  missing,
  projectId,
}: {
  ready: boolean;
  missing: { label: string; anchor: string }[];
  projectId: string;
}) {
  if (ready) {
    return (
      <div className="rounded-2xl border border-aqua-600/30 bg-gradient-to-br from-aqua-500/[0.07] to-aqua-500/[0.02] p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-aqua-500/15 text-aqua-300">
            <CheckIcon className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-aqua-300">
              You're all set
            </div>
            <h3 className="mt-0.5 text-lg font-semibold tracking-tight text-fog-100">
              Ready to run your first active pen test
            </h3>
            <p className="mt-1 text-[13px] leading-relaxed text-fog-400">
              Head to the Overview and click <b className="text-fog-200">Run active pen test</b>.
              The scan takes a few minutes and you can leave this tab open.
            </p>
          </div>
          <Link
            href={`/dashboard?project=${projectId}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-aqua-400 to-aqua-600 px-4 py-2.5 text-sm font-medium text-ink-950 shadow-sm shadow-aqua-500/20 transition-transform hover:scale-[1.02]"
          >
            Go to Overview
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-line/70 bg-ink-900/30 p-6">
      <div className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-fog-500">
        Almost there
      </div>
      <h3 className="mt-0.5 text-lg font-semibold tracking-tight text-fog-100">
        {missing.length === 1
          ? `1 step left before you can scan`
          : `${missing.length} steps left before you can scan`}
      </h3>
      <ul className="mt-3 flex flex-wrap gap-2">
        {missing.map((m) => (
          <li key={m.anchor}>
            <a
              href={m.anchor}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line/70 bg-ink-900/60 px-3 py-1.5 text-[12.5px] text-fog-200 transition-colors hover:border-line hover:text-fog-100"
            >
              {m.label}
              <ArrowRightIcon className="h-3.5 w-3.5 text-fog-500" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
