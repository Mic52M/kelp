import { EmptyState } from "@/components/EmptyState";
import { FindingCard } from "@/components/FindingCard";
import { PageHeader, PageHero } from "@/components/dashboard/PageHeader";
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
      <main className="mx-auto w-full max-w-5xl flex-1 px-8 py-14">
        {!project ? (
          <EmptyState
            title="No findings yet"
            body="Connect a project so Kelp can scan it — the results will show up here."
            cta={{ href: "/onboarding", label: "Connect a project" }}
          />
        ) : (
          <>
            <PageHero
              label={project.name}
              title="Active issues"
              description={
                active.length === 0
                  ? "You're clear on the last scan — nothing to fix right now."
                  : `${active.length} ${active.length === 1 ? "finding" : "findings"} still open on this project.`
              }
            />

            <div className="mt-10 space-y-3">
              {active.map((f) => (
                <FindingCard key={f.id} finding={f} />
              ))}
              {active.length === 0 && (
                <div className="rounded-2xl border border-line/60 bg-ink-900/30 px-6 py-14 text-center text-sm text-fog-400">
                  No active findings — you're clear on the last scan.
                </div>
              )}
            </div>

            {resolved.length > 0 && (
              <div className="mt-16">
                <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-fog-500">
                  Resolved
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-fog-300">
                  Fixed on the last scan
                </h2>
                <div className="mt-6 space-y-3 opacity-70">
                  {resolved.map((f) => (
                    <FindingCard key={f.id} finding={f} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
