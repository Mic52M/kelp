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
  const {
    project,
    projectOptions,
    findings,
    summary,
    scanStatus,
    scanMode,
    scanIssues,
    activePentest,
    agentReport,
  } = await loadDashboard(params.project);
  const scanning = scanStatus === "queued" || scanStatus === "running";
  const openActive = findings.filter(
    (f) => f.status !== "resolved" && f.status !== "needs_review",
  );
  const active = openActive.filter((f) => f.fromLatestScan);
  const carryover = openActive.filter((f) => !f.fromLatestScan);
  const needsJudgment = findings.filter((f) => f.status === "needs_review");
  const resolved = findings.filter((f) => f.status === "resolved");
  const hasScanEver = scanStatus !== null;

  return (
    <div className="px-8 pb-24">
      {/* Context bar — project switcher + last-scan meta + primary actions.
          The global TopNav lives above this. */}
      <div className="flex flex-wrap items-center gap-4 border-b border-[color:var(--color-hair)] py-5">
        {project ? (
          <ProjectSwitcher
            current={{ id: project.id, name: project.name, repo: project.repo }}
            options={projectOptions}
          />
        ) : (
          <div className="flex items-center gap-3 border border-[color:var(--color-hair)] px-3 py-1.5 text-[13px]">
            <span className="inline-block h-1.5 w-1.5 bg-[color:var(--color-paper-600)]" aria-hidden />
            <span className="text-[color:var(--color-paper-300)]">No project yet</span>
          </div>
        )}
        {project && scanStatus !== null && (
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
            Last scan · {project.lastScan}
          </span>
        )}
        {project && scanStatus === null && (
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
            No scan yet
          </span>
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
        </div>
      </div>

      <main className="pt-14">
        <div className="eyebrow flex items-center gap-3">
          <span className="h-px w-6 bg-[color:var(--color-hair-strong)]" aria-hidden />
          <span>§ Overview</span>
        </div>

        {scanning ? (
          <>
            <h1 className="font-display mt-6 text-[52px] leading-[1.02] text-[color:var(--color-paper-50)]">
              {scanMode === "active_pentest" ? "Running the pen test." : "Scanning your project."}
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-[1.65] text-[color:var(--color-paper-300)]">
              We'll refresh this page automatically the moment the scan finishes.
            </p>
            <div className="mt-12">
              <ScanningView status={scanStatus} mode={scanMode} />
              {project && (
                <div className="mt-10 text-center">
                  <form action={resetStuckScanAction} className="inline-block">
                    <input type="hidden" name="projectId" value={project.id} />
                    <button
                      type="submit"
                      className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)] underline decoration-[color:var(--color-hair-strong)] underline-offset-4 transition-colors hover:text-[color:var(--color-paper-300)]"
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
            <h1 className="font-display mt-6 text-[52px] leading-[1.02] text-[color:var(--color-paper-50)]">
              Security posture.
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-[1.65] text-[color:var(--color-paper-300)]">
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

            {/* Score + severity distribution, side by side on wide viewports. */}
            <div className="mt-14 grid grid-cols-1 gap-12 border-b border-[color:var(--color-hair)] pb-14 lg:grid-cols-12 lg:gap-16">
              <div className="lg:col-span-4">
                <ScoreRing score={summary.score} />
              </div>
              <div className="lg:col-span-8">
                <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
                  Distribution
                </div>
                <div className="mt-4">
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
            </div>

            {scanIssues.length > 0 && (
              <div className="mt-10 space-y-2">
                {scanIssues.map((issue) => (
                  <div
                    key={issue}
                    className="flex items-start gap-3 border-l px-4 py-3 text-[13.5px] leading-relaxed"
                    style={{
                      borderColor: "var(--color-sev-high)",
                      color: "var(--color-paper-200, var(--color-paper-100))",
                    }}
                  >
                    <span className="font-mono" style={{ color: "var(--color-sev-high)" }}>!</span>
                    <span className="text-[color:var(--color-paper-100)]">{issue}</span>
                  </div>
                ))}
              </div>
            )}

            <FindingsSection
              eyebrow={`§ Findings · ${carryover.length > 0 ? "this scan" : "active"}`}
              title={carryover.length > 0 ? "From this scan" : "Active issues"}
              count={active.length}
              description={
                carryover.length > 0
                  ? "What the most recent pen test just filed. Older findings that weren't re-detected sit below — kept visible so nothing gets silently dropped."
                  : undefined
              }
            >
              {active.length > 0 ? (
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
                </div>
              ) : project ? (
                <QuietEmpty
                  title={
                    scanStatus === null
                      ? "No scan run yet"
                      : carryover.length > 0
                        ? "This scan filed nothing new"
                        : "No active findings"
                  }
                  body={
                    scanStatus === null
                      ? "Run a scan to see what Kelp finds."
                      : carryover.length > 0
                        ? "Everything below is carryover from earlier scans."
                        : "Kelp probed your project and everything held up."
                  }
                />
              ) : null}
            </FindingsSection>

            {carryover.length > 0 && (
              <FindingsSection
                eyebrow="§ Findings · previous scans"
                title="Carryover"
                count={carryover.length}
                description={
                  <>
                    Filed by earlier runs and still open — the latest scan didn't
                    re-detect them. Kelp won't auto-close them; use{" "}
                    <span className="text-[color:var(--color-paper-100)]">Mark resolved</span> or{" "}
                    <span className="text-[color:var(--color-paper-100)]">False positive</span> to
                    clean up.
                  </>
                }
              >
                <div className="mt-6 space-y-3 opacity-90">
                  {carryover.map((f) => (
                    <FindingCard key={f.id} finding={f} />
                  ))}
                </div>
              </FindingsSection>
            )}

            {needsJudgment.length > 0 && (
              <FindingsSection
                eyebrow="§ Needs your judgment"
                title="Kelp isn't sure"
                count={needsJudgment.length}
                accent="var(--color-sev-med)"
                description="Kelp reviewed these after the scan and downgraded them — the evidence held up, but the impact under this app's auth model wasn't clear-cut. Read the reason inside each, then mark them fixed or dismiss."
              >
                <div className="mt-6 space-y-3">
                  {needsJudgment.map((f) => (
                    <FindingCard key={f.id} finding={f} defaultOpen />
                  ))}
                </div>
              </FindingsSection>
            )}

            {resolved.length > 0 && (
              <FindingsSection
                eyebrow="§ Resolved"
                title="Fixed on the last scan"
                count={resolved.length}
                muted
              >
                <div className="mt-6 space-y-3 opacity-70">
                  {resolved.map((f) => (
                    <FindingCard key={f.id} finding={f} />
                  ))}
                </div>
              </FindingsSection>
            )}

            {agentReport && agentReport.outcomes.length > 0 && (
              <div className="mt-16">
                <AgentReportPanel report={agentReport} />
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function FindingsSection({
  eyebrow,
  title,
  count,
  description,
  accent,
  muted,
  children,
}: {
  eyebrow: string;
  title: string;
  count: number;
  description?: React.ReactNode;
  accent?: string;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-16">
      <div
        className="font-mono text-[11px] uppercase tracking-[0.16em]"
        style={{ color: accent ?? "var(--color-paper-500)" }}
      >
        {eyebrow}
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-6">
        <h2
          className="font-display text-[30px] leading-[1.1]"
          style={{ color: muted ? "var(--color-paper-300)" : "var(--color-paper-50)" }}
        >
          {title}
        </h2>
        <span className="font-mono tabular text-[12px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
          {count} {count === 1 ? "finding" : "findings"}
        </span>
      </div>
      {description && (
        <p className="mt-4 max-w-2xl text-[13.5px] leading-[1.65] text-[color:var(--color-paper-400)]">
          {description}
        </p>
      )}
      {children}
    </section>
  );
}

function QuietEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-6 border border-[color:var(--color-hair)] px-6 py-14 text-center">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
        Clear
      </div>
      <h3 className="font-display mt-3 text-[22px] leading-[1.2] text-[color:var(--color-paper-50)]">
        {title}
      </h3>
      <p className="mx-auto mt-2 max-w-md text-[13px] leading-[1.65] text-[color:var(--color-paper-400)]">
        {body}
      </p>
    </div>
  );
}
