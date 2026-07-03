import Link from "next/link";
import { FindingCard } from "@/components/FindingCard";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadDashboard } from "@/lib/data";

export default async function FindingsPage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { project, findings } = await loadDashboard();
  const active = findings.filter((f) => f.status !== "resolved");
  const resolved = findings.filter((f) => f.status === "resolved");

  return (
    <>
      <PageHeader title="Findings" email={user?.email} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        {!project ? (
          <div className="rounded-2xl border border-line/60 bg-ink-900/30 px-6 py-16 text-center">
            <p className="text-sm text-fog-400">Connect a project to see findings.</p>
            <Link
              href="/onboarding"
              className="mt-4 inline-block rounded-lg bg-gradient-to-r from-aqua-400 to-aqua-600 px-4 py-2 text-sm font-medium text-ink-950"
            >
              Connect a project
            </Link>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">{project.name}</h2>
              <span className="text-sm text-fog-400">{active.length} active</span>
            </div>
            <div className="mt-4 space-y-3">
              {active.map((f) => (
                <FindingCard key={f.id} finding={f} />
              ))}
              {active.length === 0 && (
                <div className="rounded-xl border border-line/60 bg-ink-900/30 px-4 py-8 text-center text-sm text-fog-400">
                  No active findings — you’re clear on the last scan.
                </div>
              )}
            </div>

            {resolved.length > 0 && (
              <>
                <h3 className="mt-10 text-lg font-medium text-fog-400">Resolved</h3>
                <div className="mt-4 space-y-3 opacity-70">
                  {resolved.map((f) => (
                    <FindingCard key={f.id} finding={f} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </main>
    </>
  );
}
