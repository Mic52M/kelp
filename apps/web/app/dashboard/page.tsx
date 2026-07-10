import Link from "next/link";
import { Button, buttonClasses } from "@/components/Button";
import { ProjectSwitcher } from "@/components/dashboard/ProjectSwitcher";
import { ActivePentestButton } from "@/components/dashboard/ActivePentestButton";
import { FindingCard } from "@/components/FindingCard";
import { ScoreRing } from "@/components/ScoreRing";
import { SeverityMeter } from "@/components/dashboard/SeverityMeter";
import { ScanningView } from "@/components/ScanningView";
import { AgentReportPanel } from "@/components/dashboard/AgentReportPanel";
import { getServerSupabase } from "@/lib/supabase/server";
import { ensureTenant } from "@/lib/tenant";
import { loadDashboard } from "@/lib/data";
import { rescanAction, resetStuckScanAction } from "./actions";

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
  const { project, projectOptions, findings, summary, scanStatus, scanMode, scanIssues, activePentest, agentReport } =
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
        {project && scanStatus !== null && (
          <span className="text-xs text-fog-500">Last scan {project.lastScan}</span>
        )}
        {project && scanStatus === null && (
          <span className="text-xs text-fog-500">No scan yet</span>
        )}
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

        {scanning ? (
          <>
            {/* Full-space scanning takeover (#7 tail): the old ScoreRing/stats
                and Findings list are hidden while a scan runs so the user's
                attention is on progress, not stale numbers. */}
            <h1 className="text-4xl font-semibold tracking-tight sm:text-[42px]">
              {scanMode === "active_pentest" ? "Running the pen test" : "Scanning your project"}
            </h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-fog-300">
              We'll refresh this page automatically the moment the scan finishes.
            </p>
            <div className="mt-10">
              <ScanningView status={scanStatus} mode={scanMode} />
              {project && (
                <div className="mt-8 text-center">
                  <form action={resetStuckScanAction} className="inline-block">
                    <input type="hidden" name="projectId" value={project.id} />
                    <button
                      type="submit"
                      className="text-[12px] text-fog-500 underline decoration-fog-700 underline-offset-2 transition-colors hover:text-fog-300"
                    >
                      Scan feels stuck? Reset it
                    </button>
                  </form>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Hero — big title with accent gradient, one-line context */}
            <h1 className="text-4xl font-semibold tracking-tight sm:text-[42px]">
              Security posture
            </h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-fog-300">
              {!project
                ? "Connect a project to run your first scan."
                : scanStatus === null
                  ? "No scan has been run yet — click Re-scan or Run active pen test to start."
                  : summary.critical > 0
                    ? `${summary.critical} critical ${summary.critical === 1 ? "issue needs" : "issues need"} your attention right now.`
                    : findings.length > 0
                      ? "No critical issues — nice work. Review the items below."
                      : "Nothing found in the last scan. You're clear."}
            </p>

            {/* Score + severity distribution: one open surface, premium */}
            <div className="mt-10 flex flex-col items-start gap-10 sm:flex-row sm:items-center sm:gap-14">
              <ScoreRing score={summary.score} />
              <div className="w-full flex-1">
                <SeverityMeter
                  counts={{
                    critical: summary.critical,
                    high: summary.high,
                    medium: summary.medium,
                    low: summary.low ?? 0,
                    resolved: summary.resolved,
                  }}
                  hasScan={scanStatus !== null}
                />
              </div>
            </div>

            {/* Subtle rule separating hero from list — Resend uses these a lot */}
            <div className="mt-14 h-px w-full bg-gradient-to-r from-transparent via-line to-transparent" />

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
                  <div className="rounded-2xl border border-line/60 bg-ink-900/30 px-6 py-16 text-center">
                    <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-aqua-500/10 text-aqua-300">
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
                        <path d="m4.5 10.5 3.5 3.5L15.5 6" />
                      </svg>
                    </div>
                    <p className="mt-3.5 text-sm font-medium text-fog-200">
                      {scanStatus === null ? "No scan run yet" : "No active findings"}
                    </p>
                    <p className="mt-1 text-[13px] text-fog-500">
                      {scanStatus === null
                        ? "Run a scan to see what Kelp finds."
                        : "Kelp probed your project and everything held up."}
                    </p>
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

            {agentReport && agentReport.outcomes.length > 0 && (
              <AgentReportPanel report={agentReport} />
            )}
          </>
        )}
      </main>
    </>
  );
}

