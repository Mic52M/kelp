import Link from "next/link";
import { Button, buttonClasses } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { PageHero } from "@/components/dashboard/PageHeader";
import { loadProjects } from "@/lib/data";
import { rescanAction, resetStuckScanAction } from "../actions";

export default async function ProjectsPage() {
  const projects = await loadProjects();

  return (
    <div className="px-8 pb-24 pt-14">
      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          body="Connect a GitHub repository or a Supabase project to run your first Kelp scan."
          cta={{ href: "/onboarding", label: "Connect your first project" }}
        />
      ) : (
        <>
          <PageHero
            label="§ Projects · workspace"
            title="Projects."
            description={`${projects.length} connected ${projects.length === 1 ? "project" : "projects"} — re-scan any of them or connect a new one.`}
            action={
              <Link href="/onboarding" className={buttonClasses("primary")}>
                Connect project
              </Link>
            }
          />

          <div className="mt-14 divide-y divide-[color:var(--color-hair)] border-y border-[color:var(--color-hair)]">
            {projects.map((p) => {
              const scanning = p.scanStatus === "queued" || p.scanStatus === "running";
              return (
                <div
                  key={p.id}
                  className="grid grid-cols-1 items-center gap-4 py-5 lg:grid-cols-12"
                >
                  <div className="flex items-center gap-3 lg:col-span-1">
                    <span
                      className="inline-block h-1.5 w-1.5"
                      style={{
                        background: scanning
                          ? "var(--color-signal)"
                          : "var(--color-paper-600)",
                      }}
                      aria-hidden
                    />
                  </div>
                  <div className="min-w-0 lg:col-span-6">
                    <div className="font-display text-[18px] leading-[1.2] text-[color:var(--color-paper-50)]">
                      {p.name}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11.5px] text-[color:var(--color-paper-500)]">
                      {p.repo && <span>{p.repo}</span>}
                      {p.repo && p.supabaseRef && <span aria-hidden>·</span>}
                      {p.supabaseRef && <span>Supabase · {p.supabaseRef}</span>}
                    </div>
                  </div>
                  <div className="lg:col-span-2 lg:text-right">
                    <span className="font-mono tabular text-[12px] uppercase tracking-[0.14em] text-[color:var(--color-paper-400)]">
                      {p.activeFindings} {p.activeFindings === 1 ? "finding" : "findings"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 lg:col-span-3 lg:justify-end">
                    <form action={rescanAction}>
                      <input type="hidden" name="projectId" value={p.id} />
                      <Button type="submit" variant="secondary" size="sm" disabled={scanning}>
                        {scanning ? "Scanning…" : "Re-scan"}
                      </Button>
                    </form>
                    {scanning && (
                      <form action={resetStuckScanAction}>
                        <input type="hidden" name="projectId" value={p.id} />
                        <button
                          type="submit"
                          className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)] underline decoration-[color:var(--color-hair-strong)] underline-offset-4 transition-colors hover:text-[color:var(--color-paper-300)]"
                        >
                          Reset if stuck
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
