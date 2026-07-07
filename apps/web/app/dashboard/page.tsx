import Link from "next/link";
import { Button, buttonClasses } from "@/components/Button";
import { ProjectSwitcher } from "@/components/dashboard/ProjectSwitcher";
import { ActivePentestButton } from "@/components/dashboard/ActivePentestButton";
import { FindingCard } from "@/components/FindingCard";
import { ScoreRing } from "@/components/ScoreRing";
import { ScanningView } from "@/components/ScanningView";
import { getServerSupabase } from "@/lib/supabase/server";
import { ensureTenant } from "@/lib/tenant";
import { loadDashboard } from "@/lib/data";
import { rescanAction } from "./actions";

export default async function Dashboard({
  searchParams,
}: {
  searchParams?: Promise<{ project?: string }>;
}) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.email) {
    await ensureTenant({ id: user.id, email: user.email });
  }

  const params = (await searchParams) ?? {};
  const { project, projectOptions, findings, summary, scanStatus, scanMode, scanIssues, activePentest } =
    await loadDashboard(params.project);
  const scanning = scanStatus === "queued" || scanStatus === "running";
  const active = findings.filter((f) => f.status !== "resolved");
  const resolved = findings.filter((f) => f.status === "resolved");

  return (
    <>
      {/* Topbar */}
      <header className="flex items-center gap-4 border-b border-line/70 px-8 py-4">
        {project ? (
          <ProjectSwitcher
            current={{ id: project.id, name: project.name, repo: project.repo }}
            options={projectOptions}
          />
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-line bg-ink-800/60 px-3 py-1.5 text-sm">
            <span className="h-2 w-2 rounded-full bg-fog-600" />
            <span className="font-medium">No project yet</span>
          </div>
        )}
        {project && <span className="text-xs text-fog-500">Last scan {project.lastScan}</span>}
        <div className="ml-auto flex items-center gap-3">
          {project ? (
            <>
              <ActivePentestButton
                projectId={project.id}
                gate={activePentest}
                scanning={scanning}
              />
              <form action={rescanAction}>
                <input type="hidden" name="projectId" value={project.id} />
                <Button type="submit" variant="secondary" disabled={scanning}>
                  {scanning ? "Scanning…" : "Re-scan"}
                </Button>
              </form>
            </>
          ) : (
            <Link href="/onboarding" className={buttonClasses("primary")}>
              Connect a project
            </Link>
          )}
          {user?.email && (
            <span className="hidden text-xs text-fog-400 sm:inline">{user.email}</span>
          )}
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-aqua-500 to-violet-500" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-8 py-14">
        {/* Section label — Resend-style tiny uppercase */}
        <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-fog-500">
          Overview
        </div>

        {/* Hero — big title with accent gradient, one-line context */}
        <h1 className="text-4xl font-semibold tracking-tight sm:text-[42px]">
          Security posture
        </h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-fog-300">
          {!project
            ? "Connect a project to run your first scan."
            : summary.critical > 0
              ? `${summary.critical} critical ${summary.critical === 1 ? "issue needs" : "issues need"} your attention right now.`
              : findings.length > 0
                ? "No critical issues — nice work. Review the items below."
                : "Nothing found in the last scan. You're clear."}
        </p>

        {/* Score + stats: one open surface, not four boxed cards */}
        <div className="mt-10 flex flex-col items-start gap-10 sm:flex-row sm:items-center sm:gap-16">
          <ScoreRing score={summary.score} />
          <div className="grid w-full grid-cols-2 gap-x-10 gap-y-6 sm:grid-cols-4 sm:gap-x-14">
            <Stat label="Critical" value={summary.critical} color="var(--color-crit)" />
            <Stat label="High" value={summary.high} color="var(--color-high)" />
            <Stat label="Medium" value={summary.medium} color="var(--color-med)" />
            <Stat label="Resolved" value={summary.resolved} color="var(--color-ok)" />
          </div>
        </div>

        {/* Subtle rule separating hero from list — Resend uses these a lot */}
        <div className="mt-14 h-px w-full bg-gradient-to-r from-transparent via-line to-transparent" />

        {scanning ? (
          <div className="mt-10">
            <ScanningView status={scanStatus} mode={scanMode} />
          </div>
        ) : (
          <>
            {scanIssues.length > 0 && (
              <div className="mt-10 space-y-2">
                {scanIssues.map((issue) => (
                  <div
                    key={issue}
                    className="flex items-start gap-2.5 rounded-xl border border-[color:var(--color-high)]/25 bg-[color:var(--color-high)]/[0.06] px-4 py-3 text-sm text-fog-200"
                  >
                    <span className="mt-0.5 text-[color:var(--color-high)]">!</span>
                    <span>{issue}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Findings */}
            <div className="mt-14">
              <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-fog-500">
                Findings
              </div>
              <div className="flex items-baseline justify-between">
                <h2 className="text-2xl font-semibold tracking-tight">Active issues</h2>
                <span className="text-sm text-fog-400">
                  {active.length} {active.length === 1 ? "finding" : "findings"}
                </span>
              </div>
              <div className="mt-6 space-y-3">
                {active.map((f, i) => (
                  <div
                    key={f.id}
                    className="animate-rise"
                    style={{ animationDelay: `${i * 60}ms`, animationFillMode: "both" }}
                  >
                    <FindingCard finding={f} />
                  </div>
                ))}
                {active.length === 0 && project && (
                  <div className="rounded-2xl border border-line/60 bg-ink-900/30 px-6 py-14 text-center text-sm text-fog-400">
                    No active findings on the last scan.
                  </div>
                )}
              </div>
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
                  {resolved.map((f, i) => (
                    <div
                      key={f.id}
                      className="animate-rise"
                      style={{ animationDelay: `${(active.length + i) * 60}ms`, animationFillMode: "both" }}
                    >
                      <FindingCard finding={f} />
                    </div>
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

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="text-3xl font-semibold tabular-nums" style={{ color }}>
        {value}
      </div>
      <div className="mt-1 text-xs uppercase tracking-wider text-fog-500">{label}</div>
    </div>
  );
}
