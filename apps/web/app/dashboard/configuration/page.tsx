// Configuration route — the dedicated per-project setup surface for a first
// active pen test. Redesigned 2026-07-09 around three principles:
//
//  1. Progress. The user always sees "X of 3 done" at the top and per-step
//     status pills, so they know exactly what to do next.
//  2. Progressive disclosure. Done steps collapse to a summary; incomplete
//     ones stay open and prompt inline. Advanced knobs live behind a single
//     collapsible so 90% of users never see them.
//  3. Warm, non-technical copy. The audience is a solo founder who built with
//     Lovable/Bolt and has never read a security consent form. Guidance for
//     each input is prominent, not buried.

import Link from "next/link";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { ProjectSwitcher } from "@/components/dashboard/ProjectSwitcher";
import { BackendCard } from "@/components/dashboard/config/BackendCard";
import { TestAccountsCard } from "@/components/dashboard/config/TestAccountsCard";
import { ConsentCard } from "@/components/dashboard/config/ConsentCard";
import { AdvancedGroup } from "@/components/dashboard/config/AdvancedGroup";
import { ConfigProgress } from "@/components/dashboard/config/ConfigProgress";
import { ReadyBanner } from "@/components/dashboard/config/ReadyBanner";
import { BackendReportBanner } from "@/components/dashboard/config/BackendReportBanner";
import { UnsupportedBackendCard } from "@/components/dashboard/config/UnsupportedBackendCard";
import { UnknownBackendCard } from "@/components/dashboard/config/UnknownBackendCard";
import { AnalyzingCard } from "@/components/dashboard/config/AnalyzingCard";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadProjects } from "@/lib/data";
import { CONSENT_V3_TEXT, CONSENT_VERSION_LATEST } from "@kelp/core";
import {
  loadActiveTestConsent,
  loadBackendReport,
  findUserEmail,
  findOrgName,
  getProjectConfigStatus,
} from "@kelp/worker";
import type { ProjectConsent } from "@/components/dashboard/ActiveTestingConsentForm";

export default async function ConfigurationPage({
  searchParams,
}: {
  searchParams?: Promise<{ project?: string }>;
}) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const projects = await loadProjects();

  if (projects.length === 0) {
    return (
      <>
        <PageHeader title="Configuration" email={user?.email} />
        <main className="mx-auto w-full max-w-3xl flex-1 px-8 py-14">
          <EmptyProjects />
        </main>
      </>
    );
  }

  const params = (await searchParams) ?? {};
  const selectedId = params.project ?? projects[0]!.id;
  const current = projects.find((p) => p.id === selectedId) ?? projects[0]!;

  const status = await getProjectConfigStatus(current.id);
  const consentRow = await loadActiveTestConsent(current.id);
  const [consentedByEmail, orgName] = consentRow
    ? await Promise.all([findUserEmail(consentRow.consentedBy), findOrgName(consentRow.orgId)])
    : [null, null];

  const consents: ProjectConsent[] = [
    {
      projectId: current.id,
      projectName: current.name,
      status: consentRow ? "granted" : "none",
      version: consentRow?.consentVersion ?? null,
      consentedAt: consentRow?.consentedAt.toISOString() ?? null,
      consentedByEmail,
      orgName,
    },
  ];

  const supabaseProjectRef =
    current.supabaseRef && current.supabaseRef !== "—" ? current.supabaseRef : null;

  const supabaseLinked = Boolean(supabaseProjectRef);

  // Fetch Kelp's analyzer output for this project. Older projects (connected
  // before the analyzer shipped) may not have one yet — we render an
  // AnalyzingCard that triggers on-demand analysis, then refreshes.
  const backendReport = await loadBackendReport(current.id).catch(() => null);
  const backendType = backendReport?.primary.type ?? null;
  const isSupabaseBackend =
    backendType === null || backendType === "supabase"; // treat "no report yet" like supabase for onboarding UX (most users)
  const isUnsupportedBackend =
    backendType === "firebase" ||
    backendType === "convex" ||
    backendType === "custom-api";
  const isUnknownBackend = backendType === "unknown";

  // Kelp identified Supabase but the anti-fabrication gate stripped everything
  // (or the analyzer found nothing to cite). Message on the BackendCard shifts
  // from "auto-detect handles this" to "we can't read it, paste the values".
  const supabaseDetectedButNotExtracted =
    backendReport?.primary.type === "supabase" &&
    !backendReport.publicConfig.supabaseUrl &&
    !backendReport.publicConfig.supabaseAnonKey &&
    !supabaseProjectRef &&
    !status.hasSupabaseAnonKey;

  const projectOptions = projects.map((p) => ({
    id: p.id,
    name: p.name,
    repo: p.repo ?? null,
  }));

  // Derive per-step readiness — used by both the progress banner and the
  // bottom "Ready to scan" CTA. Keep this in one place so a change to the
  // criteria propagates everywhere at once.
  const backendReady = Boolean(supabaseProjectRef) && status.hasSupabaseAnonKey;
  const accountsReady = status.testAccountAEmail !== null && status.testAccountBEmail !== null;
  const consentReady = Boolean(consentRow);

  const steps = [
    { label: "Backend", done: backendReady, anchor: "#backend" },
    { label: "Test accounts", done: accountsReady, anchor: "#test-accounts" },
    { label: "Consent", done: consentReady, anchor: "#consent" },
  ];
  const allReady = steps.every((s) => s.done);
  const missing = steps
    .filter((s) => !s.done)
    .map((s) => ({ label: s.label, anchor: s.anchor }));

  return (
    <>
      <PageHeader title="Configuration" email={user?.email} />

      <header className="flex items-center gap-4 border-b border-line/70 px-8 py-4">
        <ProjectSwitcher
          current={{ id: current.id, name: current.name, repo: current.repo ?? "" }}
          options={projectOptions}
        />
        <span className="text-xs text-fog-500">
          Configuration is scoped to the selected project.
        </span>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-8 py-12">
        {/* Hero — short, human. No feature list. */}
        <div className="mb-8">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-fog-500">
            Setup
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-[34px]">
            Get{" "}
            <span className="text-fog-100">{current.name}</span>{" "}
            <span className="text-fog-400">ready to scan</span>
          </h1>
          <p className="mt-2.5 max-w-xl text-[14.5px] leading-relaxed text-fog-400">
            Three quick steps. Save each one as you go — you can pause and pick up any
            time.
          </p>
        </div>

        {/* Kelp's read on the connected repo. Renders null when no report yet. */}
        {backendReport && (
          <div className="mb-8">
            <BackendReportBanner report={backendReport} projectId={current.id} />
          </div>
        )}

        {/* Loading state: project connected but analyzer hasn't run yet. */}
        {!backendReport && (
          <div className="mb-8">
            <AnalyzingCard projectId={current.id} />
          </div>
        )}

        {/* Firebase / Convex / custom-API — honest "not scannable yet" state. */}
        {isUnsupportedBackend && backendReport && (
          <div className="mb-8">
            <UnsupportedBackendCard report={backendReport} />
          </div>
        )}

        {/* Unknown backend — nudge user to manual entry or waitlist. */}
        {isUnknownBackend && (
          <div className="mb-8">
            <UnknownBackendCard />
          </div>
        )}

        {/* Full 3-step Supabase flow: shown when we're on a Supabase repo OR
            the user wants to fill it in manually (unknown backend path). Hidden
            entirely on unsupported backends — the user can't complete the pen
            test there and forcing the form on them is misleading. */}
        {(isSupabaseBackend || isUnknownBackend) && backendReport && (
          <>
            <ConfigProgress steps={steps} />

            <div className="mt-8 space-y-6">
              <BackendCard
                projectId={current.id}
                projectName={current.name}
                supabaseProjectRef={supabaseProjectRef}
                hasSupabaseAnonKey={status.hasSupabaseAnonKey}
                hasSupabaseManagement={status.hasSupabaseManagement}
                supabaseDetectedButNotExtracted={supabaseDetectedButNotExtracted}
              />

          <TestAccountsCard
            projectId={current.id}
            hasAccountA={status.testAccountAEmail !== null}
            hasAccountB={status.testAccountBEmail !== null}
            testAccountAEmail={status.testAccountAEmail}
            testAccountBEmail={status.testAccountBEmail}
          />

          <ConsentCard
            consents={consents}
            copy={CONSENT_V3_TEXT}
            version={CONSENT_VERSION_LATEST}
          />
        </div>

            <div className="mt-8">
              <AdvancedGroup
                projectId={current.id}
                supabaseLinked={supabaseLinked}
                hasReadonly={status.hasSupabaseReadonly}
                hasManagement={status.hasSupabaseManagement}
              />
            </div>

            <div className="mt-10">
              <ReadyBanner ready={allReady} missing={missing} projectId={current.id} />
            </div>
          </>
        )}
      </main>
    </>
  );
}

function EmptyProjects() {
  return (
    <div className="rounded-2xl border border-line/70 bg-ink-900/40 p-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-fog-500/10 text-fog-400">
        <span className="text-xl">+</span>
      </div>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">No project yet</h1>
      <p className="mt-2 text-sm text-fog-400">
        Connect one to start. Configuration is scoped per-project.
      </p>
      <Link
        href="/onboarding"
        className="mt-6 inline-flex rounded-lg bg-gradient-to-r from-aqua-400 to-aqua-600 px-4 py-2.5 text-sm font-medium text-ink-950"
      >
        Connect a project
      </Link>
    </div>
  );
}
