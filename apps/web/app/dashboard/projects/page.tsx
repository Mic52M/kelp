import Link from "next/link";
import { Button, buttonClasses } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
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
          <Link href="/onboarding" className={buttonClasses("primary")}>
            Connect project
          </Link>
        }
      />
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        {projects.length === 0 ? (
          <EmptyState
            title="No projects yet"
            body="Connect a GitHub repository or a Supabase project to run your first Kelp scan."
            cta={{ href: "/onboarding", label: "Connect your first project" }}
          />
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
                  <form action={rescanAction} className="shrink-0">
                    <input type="hidden" name="projectId" value={p.id} />
                    <Button type="submit" variant="secondary" size="sm" disabled={scanning}>
                      {scanning ? "Scanning…" : "Re-scan"}
                    </Button>
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
