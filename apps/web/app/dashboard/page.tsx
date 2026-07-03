import Link from "next/link";
import { Logo } from "@/components/Logo";
import { FindingCard } from "@/components/FindingCard";
import { ScoreRing } from "@/components/ScoreRing";
import { ScanningView } from "@/components/ScanningView";
import { getServerSupabase } from "@/lib/supabase/server";
import { ensureTenant } from "@/lib/tenant";
import { loadDashboard } from "@/lib/data";
import { signOut } from "@/app/login/actions";
import { rescanAction } from "./actions";

const nav = [
  { label: "Overview", active: true },
  { label: "Findings", active: false },
  { label: "Projects", active: false },
  { label: "Settings", active: false },
];

export default async function Dashboard() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.email) {
    await ensureTenant({ id: user.id, email: user.email });
  }

  const { project, findings, summary, scanStatus, scanIssues } = await loadDashboard();
  const scanning = scanStatus === "queued" || scanStatus === "running";
  const active = findings.filter((f) => f.status !== "resolved");
  const resolved = findings.filter((f) => f.status === "resolved");

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line/70 bg-ink-900/40 px-4 py-5 lg:flex">
        <Link href="/">
          <Logo />
        </Link>
        <div className="mt-8 px-1 text-xs font-medium uppercase tracking-wider text-fog-500">
          Workspace
        </div>
        <nav className="mt-3 space-y-1">
          {nav.map((n) => (
            <button
              key={n.label}
              className={`flex w-full items-center rounded-lg px-3 py-2 text-sm transition-colors ${
                n.active
                  ? "bg-ink-700/60 text-fog-50"
                  : "text-fog-400 hover:bg-white/[0.02] hover:text-fog-50"
              }`}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto rounded-xl border border-aqua-600/30 bg-aqua-500/[0.06] p-3 text-xs">
          <div className="font-medium text-fog-50">Free plan</div>
          <p className="mt-1 text-fog-400">1 scan used. Upgrade for continuous cover and auto-fix.</p>
          <button className="mt-2 w-full rounded-md bg-gradient-to-r from-aqua-400 to-aqua-600 px-2 py-1.5 font-medium text-ink-950">
            Upgrade
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="flex items-center gap-4 border-b border-line/70 px-6 py-3.5">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-ink-800/60 px-3 py-1.5 text-sm">
            <span className={`h-2 w-2 rounded-full ${project ? "bg-aqua-400" : "bg-fog-600"}`} />
            <span className="font-medium">{project?.name ?? "No project yet"}</span>
            {project && <span className="font-mono text-xs text-fog-500">{project.repo}</span>}
          </div>
          {project && <span className="text-xs text-fog-500">Last scan {project.lastScan}</span>}
          <div className="ml-auto flex items-center gap-3">
            {project ? (
              <form action={rescanAction}>
                <input type="hidden" name="projectId" value={project.id} />
                <button
                  type="submit"
                  className="rounded-lg border border-line bg-ink-800 px-3.5 py-2 text-sm font-medium text-fog-50 transition-colors hover:bg-ink-700"
                >
                  Re-scan
                </button>
              </form>
            ) : (
              <Link
                href="/onboarding"
                className="rounded-lg bg-gradient-to-r from-aqua-400 to-aqua-600 px-3.5 py-2 text-sm font-medium text-ink-950 transition-opacity hover:opacity-90"
              >
                Connect a project
              </Link>
            )}
            {user?.email && (
              <span className="hidden text-xs text-fog-400 sm:inline">{user.email}</span>
            )}
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg border border-line bg-ink-800 px-3 py-2 text-xs text-fog-300 transition-colors hover:text-fog-50"
              >
                Sign out
              </button>
            </form>
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-aqua-500 to-violet-500" />
          </div>
        </header>

        <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
          {/* Posture header */}
          <div className="glass flex flex-col items-center gap-6 rounded-2xl p-6 sm:flex-row sm:gap-8">
            <ScoreRing score={summary.score} />
            <div className="flex-1">
              <h1 className="text-xl font-semibold">Security posture</h1>
              <p className="mt-1 text-sm text-fog-300">
                {!project
                  ? "Connect a project to run your first scan."
                  : summary.critical > 0
                    ? `${summary.critical} critical ${summary.critical === 1 ? "issue" : "issues"} need your attention right now.`
                    : findings.length > 0
                      ? "No critical issues — nice work. Review the items below."
                      : "No issues found in the last scan."}
              </p>
              <div className="mt-4 grid grid-cols-4 gap-3">
                <Stat label="Critical" value={summary.critical} color="var(--color-crit)" />
                <Stat label="High" value={summary.high} color="var(--color-high)" />
                <Stat label="Medium" value={summary.medium} color="var(--color-med)" />
                <Stat label="Resolved" value={summary.resolved} color="var(--color-ok)" />
              </div>
            </div>
          </div>

          {scanning ? (
            <ScanningView status={scanStatus} />
          ) : (
            <>
              {scanIssues.length > 0 && (
                <div className="mt-8 space-y-2">
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
              <div className="mt-8 flex items-center justify-between">
                <h2 className="text-lg font-medium">Findings</h2>
                <span className="text-sm text-fog-400">{active.length} active</span>
              </div>
              <div className="mt-4 space-y-3">
                {active.map((f) => (
                  <FindingCard key={f.id} finding={f} />
                ))}
                {active.length === 0 && project && (
                  <div className="rounded-xl border border-line/60 bg-ink-900/30 px-4 py-8 text-center text-sm text-fog-400">
                    No active findings on the last scan.
                  </div>
                )}
              </div>

              {resolved.length > 0 && (
                <>
                  <h2 className="mt-10 text-lg font-medium text-fog-400">Resolved</h2>
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
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border border-line/70 bg-ink-900/50 px-3 py-2.5">
      <div className="text-2xl font-semibold" style={{ color }}>
        {value}
      </div>
      <div className="text-xs text-fog-400">{label}</div>
    </div>
  );
}
