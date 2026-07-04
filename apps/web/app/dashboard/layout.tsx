import { Suspense } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar uses useSearchParams (to carry ?project across nav) which forces
          a CSR bailout — Suspense keeps every dashboard subroute prerender-safe. */}
      <Suspense fallback={<aside className="hidden w-60 shrink-0 border-r border-line/70 bg-ink-900/40 lg:block" />}>
        <Sidebar />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
