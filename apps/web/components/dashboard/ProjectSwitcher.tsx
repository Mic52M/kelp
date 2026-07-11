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
        className={`flex items-center gap-3 border border-[color:var(--color-hair)] bg-transparent px-3 py-1.5 text-[13px] transition-colors ${
          hasChoice
            ? "hover:border-[color:var(--color-hair-strong)]"
            : "cursor-default"
        }`}
      >
        <span className="inline-block h-1.5 w-1.5 bg-[color:var(--color-signal)]" aria-hidden />
        <span className="text-[color:var(--color-paper-50)]">{current.name}</span>
        <span className="font-mono text-[11.5px] text-[color:var(--color-paper-500)]">
          {current.repo}
        </span>
        {hasChoice && (
          <svg
            aria-hidden
            className={`h-3 w-3 text-[color:var(--color-paper-400)] transition-transform ${open ? "rotate-180" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
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
          <div className="absolute left-0 top-full z-20 mt-1 w-80 overflow-hidden border border-[color:var(--color-hair-strong)] bg-[color:var(--color-ink-900)]">
            {options.map((o) => {
              const isCurrent = o.id === current.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => select(o.id)}
                  className="flex w-full items-center gap-3 border-b border-[color:var(--color-hair)] px-3 py-2.5 text-left text-[13px] last:border-b-0 hover:bg-[color:var(--color-ink-850)]"
                >
                  <span
                    className="inline-block h-1.5 w-1.5 shrink-0"
                    style={{
                      background: isCurrent
                        ? "var(--color-signal)"
                        : "var(--color-paper-600)",
                    }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-[color:var(--color-paper-50)]">{o.name}</span>
                    {o.repo && (
                      <span className="ml-2 font-mono text-[11.5px] text-[color:var(--color-paper-500)]">
                        {o.repo}
                      </span>
                    )}
                  </span>
                  {isCurrent && (
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-signal)]">
                      Current
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
