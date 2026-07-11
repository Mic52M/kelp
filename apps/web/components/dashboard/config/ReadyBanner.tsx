import Link from "next/link";
import { buttonClasses } from "@/components/Button";

/**
 * Bottom banner that shifts with progress. Editorial anchor — hairline shell,
 * one signal accent when ready, mono chips when incomplete.
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
      <div
        className="border p-6"
        style={{ borderColor: "var(--color-signal-dim)" }}
      >
        <div className="flex flex-wrap items-start gap-6">
          <div className="min-w-0 flex-1">
            <div
              className="font-mono text-[10.5px] uppercase tracking-[0.16em]"
              style={{ color: "var(--color-signal)" }}
            >
              § You're all set
            </div>
            <h3 className="font-display mt-3 text-[26px] leading-[1.15] text-[color:var(--color-paper-50)]">
              Ready to run your first active pen test.
            </h3>
            <p className="mt-3 max-w-xl text-[13.5px] leading-[1.65] text-[color:var(--color-paper-300)]">
              Head to the Overview and click{" "}
              <span className="text-[color:var(--color-paper-50)]">Run active pen test</span>.
              The scan takes a few minutes and you can leave this tab open.
            </p>
          </div>
          <Link
            href={`/dashboard?project=${projectId}`}
            className={buttonClasses("primary", "lg", "cta-lift")}
          >
            Go to Overview →
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="border border-[color:var(--color-hair)] p-6">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
        § Almost there
      </div>
      <h3 className="font-display mt-3 text-[22px] leading-[1.15] text-[color:var(--color-paper-50)]">
        {missing.length === 1
          ? "1 step left before you can scan."
          : `${missing.length} steps left before you can scan.`}
      </h3>
      <ul className="mt-5 flex flex-wrap gap-2">
        {missing.map((m) => (
          <li key={m.anchor}>
            <a
              href={m.anchor}
              className="inline-flex items-center gap-2 border border-[color:var(--color-hair-strong)] px-3 py-1.5 font-mono text-[11.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-100)] transition-colors hover:border-[color:var(--color-paper-300)] hover:text-[color:var(--color-paper-50)]"
            >
              {m.label}
              <span aria-hidden className="text-[color:var(--color-paper-500)]">→</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
