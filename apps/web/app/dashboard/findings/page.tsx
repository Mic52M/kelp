import { EmptyState } from "@/components/EmptyState";
import { FindingCard } from "@/components/FindingCard";
import { PageHero } from "@/components/dashboard/PageHeader";
import { ProjectSwitcher } from "@/components/dashboard/ProjectSwitcher";
import { loadDashboard } from "@/lib/data";

export default async function FindingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ project?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const { project, projectOptions, findings } = await loadDashboard(params.project);
  const active = findings.filter((f) => f.status !== "resolved");
  const resolved = findings.filter((f) => f.status === "resolved");

  return (
    <div className="px-8 pb-24">
      {project && (
        <div className="flex items-center gap-4 border-b border-[color:var(--color-hair)] py-5">
          <ProjectSwitcher
            current={{ id: project.id, name: project.name, repo: project.repo }}
            options={projectOptions}
          />
        </div>
      )}

      <div className="pt-14">
        {!project ? (
          <EmptyState
            title="No findings yet"
            body="Connect a project so Kelp can scan it — the results will show up here."
            cta={{ href: "/onboarding", label: "Connect a project" }}
          />
        ) : (
          <>
            <PageHero
              label={`§ Findings · ${project.name}`}
              title="Active issues."
              description={
                active.length === 0
                  ? "You're clear on the last scan — nothing to fix right now."
                  : `${active.length} ${active.length === 1 ? "finding" : "findings"} still open on this project.`
              }
            />

            <div className="mt-14 space-y-3">
              {active.map((f, i) => (
                <div
                  key={f.id}
                  className="animate-rise"
                  style={{ animationDelay: `${i * 60}ms`, animationFillMode: "both" }}
                >
                  <FindingCard finding={f} />
                </div>
              ))}
              {active.length === 0 && (
                <div className="border border-[color:var(--color-hair)] px-6 py-14 text-center">
                  <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
                    Clear
                  </div>
                  <p className="mt-3 font-display text-[22px] leading-[1.2] text-[color:var(--color-paper-50)]">
                    No active findings.
                  </p>
                  <p className="mt-2 text-[13px] text-[color:var(--color-paper-400)]">
                    You're clear on the last scan.
                  </p>
                </div>
              )}
            </div>

            {resolved.length > 0 && (
              <section className="mt-16">
                <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
                  § Resolved
                </div>
                <h2 className="font-display mt-3 text-[26px] leading-[1.15] text-[color:var(--color-paper-300)]">
                  Fixed on the last scan
                </h2>
                <div className="mt-6 space-y-3 opacity-70">
                  {resolved.map((f) => (
                    <FindingCard key={f.id} finding={f} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
