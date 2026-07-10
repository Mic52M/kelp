import { CheckIcon, CircleIcon } from "./icons";

/**
 * Reusable status pill used in the Configuration page. Three shapes:
 *  · done — subtle aqua, check icon
 *  · needed — amber, "Needed" label
 *  · optional — muted, "Optional" label
 * Kept tiny (11px) so multiple can sit in the same row without dominating.
 */
export function StatusPill({
  status,
  label,
}: {
  status: "done" | "needed" | "optional";
  label?: string;
}) {
  if (status === "done") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-aqua-500/12 px-2 py-0.5 text-[11px] font-medium text-aqua-300">
        <CheckIcon className="h-3 w-3" />
        {label ?? "Ready"}
      </span>
    );
  }
  if (status === "needed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-medium text-amber-300">
        <CircleIcon className="h-3 w-3" />
        {label ?? "Needed"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line/70 px-2 py-0.5 text-[11px] font-medium text-fog-500">
      {label ?? "Optional"}
    </span>
  );
}
