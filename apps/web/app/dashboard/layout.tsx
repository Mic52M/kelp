import { Suspense } from "react";
import { TopNav } from "@/components/dashboard/TopNav";
import { getServerSupabase } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="relative min-h-screen">
      <Suspense
        fallback={
          <div className="sticky top-0 z-30 h-16 border-b border-[color:var(--color-hair)] bg-[color:var(--color-ink-950)]/85 backdrop-blur" />
        }
      >
        <TopNav email={user?.email ?? null} />
      </Suspense>
      <div className="mx-auto min-w-0 max-w-[1240px]">{children}</div>
    </div>
  );
}
