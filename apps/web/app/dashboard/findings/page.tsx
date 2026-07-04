import { EmptyState } from "@/components/EmptyState";
import { FindingCard } from "@/components/FindingCard";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { ProjectSwitcher } from "@/components/dashboard/ProjectSwitcher";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadDashboard } from "@/lib/data";

export default async function FindingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ project?: string }>;
}) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const params = (await searchParams) ?? {};
  const { project, projectOptions, findings } = await loadDashboard(params.project);
  const active = findings.filter((f) => f.status !== "resolved");
  const resolved = findings.filter((f) => f.status === "resolved");

  return (
    <>
      <PageHeader
        title="Findings"
        email={user?.email}
        action={
          project && (
            <ProjectSwitcher
              current={{ id: project.id, name: project.name, repo: project.repo }}
              options={projectOptions}
            />
          )
        }
      />
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        {!project ? (
          <EmptyState
            title="No findings yet"
            body="Connect a project so Kelp can scan it — the results will show up here."
            cta={{ href: "/onboarding", label: "Connect a project" }}
          />
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
