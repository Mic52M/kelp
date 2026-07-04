// Chip in the dashboard top-bar that lets the user switch which project is being
// shown. Persists the selection in the URL (?project=<id>) so a shared/reloaded
// link stays on the same project. Without a selection, the newest project wins
// (see loadDashboard).

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

interface ProjectOption {
  id: string;
  name: string;
  repo: string | null;
}

export function ProjectSwitcher({
  current,
  options,
}: {
  current: { id: string; name: string; repo: string };
  options: ProjectOption[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const hasChoice = options.length > 1;

  function select(id: string) {
    const next = new URLSearchParams(params.toString());
    next.set("project", id);
    router.push(`?${next.toString()}`);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => hasChoice && setOpen((v) => !v)}
        disabled={!hasChoice}
        className={`flex items-center gap-2 rounded-lg border border-line bg-ink-800/60 px-3 py-1.5 text-sm ${
          hasChoice ? "transition-colors hover:bg-ink-700/60" : "cursor-default"
        }`}
      >
        <span className="h-2 w-2 rounded-full bg-aqua-400" />
        <span className="font-medium">{current.name}</span>
        <span className="font-mono text-xs text-fog-500">{current.repo}</span>
        {hasChoice && (
          <svg
            aria-hidden
            className={`h-3.5 w-3.5 text-fog-400 transition-transform ${open ? "rotate-180" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1.5 w-72 overflow-hidden rounded-lg border border-line bg-ink-900/95 shadow-xl backdrop-blur">
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => select(o.id)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-white/[0.03] ${
                  o.id === current.id ? "bg-white/[0.02]" : ""
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${o.id === current.id ? "bg-aqua-400" : "bg-fog-600"}`}
                />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{o.name}</span>
                  {o.repo && (
                    <span className="ml-2 font-mono text-xs text-fog-500">{o.repo}</span>
                  )}
                </span>
                {o.id === current.id && <span className="text-xs text-aqua-400">current</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
