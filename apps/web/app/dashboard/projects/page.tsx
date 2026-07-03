import Link from "next/link";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadProjects } from "@/lib/data";
import { rescanAction } from "../actions";

export default async function ProjectsPage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const projects = await loadProjects();

  return (
    <>
      <PageHeader
        title="Projects"
        email={user?.email}
        action={
          <Link
            href="/onboarding"
            className="rounded-lg bg-gradient-to-r from-aqua-400 to-aqua-600 px-3.5 py-2 text-sm font-medium text-ink-950 transition-opacity hover:opacity-90"
          >
            Connect project
          </Link>
        }
      />
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        {projects.length === 0 ? (
          <div className="rounded-2xl border border-line/60 bg-ink-900/30 px-6 py-16 text-center">
            <p className="text-sm text-fog-400">No projects yet.</p>
            <Link
              href="/onboarding"
              className="mt-4 inline-block rounded-lg bg-gradient-to-r from-aqua-400 to-aqua-600 px-4 py-2 text-sm font-medium text-ink-950"
            >
              Connect your first project
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {projects.map((p) => {
              const scanning = p.scanStatus === "queued" || p.scanStatus === "running";
              return (
                <div
                  key={p.id}
                  className="glass flex items-center gap-4 rounded-xl px-4 py-3.5"
                >
                  <span className={`h-2 w-2 rounded-full ${scanning ? "bg-aqua-400 animate-pulse-soft" : "bg-fog-600"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-medium">{p.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-fog-500">
                      {p.repo && <span className="font-mono">{p.repo}</span>}
                      {p.repo && p.supabaseRef && <span className="text-line">·</span>}
                      {p.supabaseRef && <span className="font-mono">Supabase {p.supabaseRef}</span>}
                    </div>
                  </div>
                  <span className="shrink-0 text-sm text-fog-400">
                    {p.activeFindings} {p.activeFindings === 1 ? "finding" : "findings"}
                  </span>
                  <form action={rescanAction}>
                    <input type="hidden" name="projectId" value={p.id} />
                    <button
                      type="submit"
                      disabled={scanning}
                      className="shrink-0 rounded-lg border border-line bg-ink-800 px-3 py-1.5 text-xs font-medium text-fog-50 transition-colors hover:bg-ink-700 disabled:opacity-40"
                    >
                      {scanning ? "Scanning…" : "Re-scan"}
                    </button>
                  </form>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
