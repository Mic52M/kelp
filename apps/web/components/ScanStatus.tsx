"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Live scan indicator. While a scan is queued or running it shows an animated
 * banner and refreshes the server component every couple of seconds, so findings
 * appear as the worker writes them — no manual reload.
 */
export function ScanStatus({ status }: { status: string | null }) {
  const router = useRouter();
  const active = status === "queued" || status === "running";

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(t);
  }, [active, router]);

  if (!active) return null;

  return (
    <div className="glass relative mt-6 flex items-center gap-3 overflow-hidden rounded-xl px-4 py-3">
      <div className="pointer-events-none absolute inset-y-0 left-0 w-24 animate-scanline bg-gradient-to-r from-aqua-500/10 to-transparent" />
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-aqua-400 opacity-60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-aqua-400" />
      </span>
      <span className="text-sm text-fog-200">
        {status === "queued" ? "Scan queued…" : "Scanning your project…"}
      </span>
      <span className="text-xs text-fog-500">findings appear here as they’re found</span>
    </div>
  );
}
