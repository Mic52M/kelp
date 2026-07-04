import { Suspense } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen">
      {/* Ambient background — the same aurora + fine grid the landing uses, so
          the dashboard reads as part of the same product, not a plain admin. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="aurora" />
        <div className="grid-texture absolute inset-0 opacity-40" />
      </div>

      {/* Sidebar uses useSearchParams (to carry ?project across nav) which forces
          a CSR bailout — Suspense keeps every dashboard subroute prerender-safe. */}
      <Suspense fallback={<aside className="hidden w-60 shrink-0 border-r border-line/70 bg-ink-900/40 lg:block" />}>
        <Sidebar />
      </Suspense>
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
