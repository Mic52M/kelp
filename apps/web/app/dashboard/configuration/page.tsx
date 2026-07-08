// Configuration route — the dedicated home for the per-project inputs an
// active pen test needs (item #7). Split out of Settings because "Settings"
// misled testers into thinking it was account-level; this route is scoped to
// a single project (chosen via ProjectSwitcher / ?project=<id>) and shows,
// in one place: the Supabase read-only credential, the legacy Management API
// token, the active-testing consent for this project, and the deployed-app
// URL + two test accounts. Every input carries the same setup guides as
// Settings did.

import Link from "next/link";
import { PageHeader, PageHero } from "@/components/dashboard/PageHeader";
import { ProjectSwitcher } from "@/components/dashboard/ProjectSwitcher";
import { ReconnectForm } from "@/components/dashboard/ReconnectForm";
import { SupabaseReadonlyForm } from "@/components/dashboard/SupabaseReadonlyForm";
import {
  ActiveTestingConsentForm,
  type ProjectConsent,
} from "@/components/dashboard/ActiveTestingConsentForm";
import {
  ActivePentestConfigForm,
  type ProjectPentestConfig,
} from "@/components/dashboard/ActivePentestConfigForm";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadProjects } from "@/lib/data";
import { CONSENT_V3_TEXT, CONSENT_VERSION_LATEST } from "@kelp/core";
import {
  loadActiveTestConsent,
  findUserEmail,
  findOrgName,
  getProjectConfigStatus,
} from "@kelp/worker";

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
          <PageHero
            label="Workspace"
            title="Configuration"
            description="Connect a project first — configuration is scoped per-project."
          />
          <div className="mt-10">
            <Link
              href="/onboarding"
              className="inline-flex rounded-lg bg-gradient-to-r from-aqua-400 to-aqua-600 px-4 py-2 text-sm font-medium text-ink-950"
            >
              Connect a project
            </Link>
          </div>
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

  const pentestConfigs: ProjectPentestConfig[] = [
    {
      projectId: current.id,
      projectName: current.name,
      appBaseUrl: status.appBaseUrl,
      hasAccountA: status.testAccountAEmail !== null,
      hasAccountB: status.testAccountBEmail !== null,
      hasSupabaseAnonKey: status.hasSupabaseAnonKey,
      hasSupabaseManagement: status.hasSupabaseManagement,
      testAccountAEmail: status.testAccountAEmail,
      testAccountBEmail: status.testAccountBEmail,
    },
  ];

  const supabaseFormProjects = current.supabaseRef
    ? [
        {
          id: current.id,
          name: current.name,
          hasManagement: status.hasSupabaseManagement,
          hasReadonly: status.hasSupabaseReadonly,
        },
      ]
    : [];

  const projectOptions = projects.map((p) => ({
    id: p.id,
    name: p.name,
    repo: p.repo ?? null,
  }));

  return (
    <>
      <PageHeader title="Configuration" email={user?.email} />

      {/* Top bar with a real ProjectSwitcher so switching stays URL-driven —
          identical to Overview so the tester's mental model doesn't fork. */}
      <header className="flex items-center gap-4 border-b border-line/70 px-8 py-4">
        <ProjectSwitcher
          current={{ id: current.id, name: current.name, repo: current.repo ?? "" }}
          options={projectOptions}
        />
        <span className="text-xs text-fog-500">
          Configuration is scoped to the selected project.
        </span>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-8 py-14">
        <PageHero
          label="Configuration"
          title={current.name}
          description="Everything Kelp needs to run passive scans and the multi-agent active pen test on this project. Save each section — nothing runs until you click Run active pen test on the Overview."
        />

        <div className="mt-12 space-y-8">
          <div className="rounded-2xl border border-aqua-600/25 bg-aqua-500/[0.04] px-6 py-5">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-aqua-300">
              Backend — auto-detected
            </div>
            <p className="text-sm leading-relaxed text-fog-300">
              Kelp reads your connected repo to detect the Supabase backend (URL, public
              anon key, and schema) — including Lovable Cloud, where you have no database
              login. <span className="text-fog-100">The only thing Kelp needs from you is
              two test accounts</span> (below). The Supabase credentials further down are
              optional — they deepen the scan when you can provide them, but the pen test
              runs without them.
            </p>
          </div>

          <Section
            label="Active testing"
            title="Test accounts — required"
            description="Kelp signs in as two low-privilege accounts on your app and probes whether one can reach the other's data. Emails are shown after saving; passwords are stored encrypted and never re-rendered."
          >
            <ActivePentestConfigForm projects={pentestConfigs} />
          </Section>

          <Section
            label="Advanced (optional)"
            title="Supabase — read-only role"
            description="Optional. Gives the agents a live database view (exact RLS state) on self-managed Supabase. Not needed for Lovable Cloud — Kelp derives the schema from your repo."
          >
            {supabaseFormProjects.length > 0 ? (
              <SupabaseReadonlyForm projects={supabaseFormProjects} />
            ) : (
              <p className="text-sm text-fog-500">
                No self-managed Supabase database linked — the schema is auto-detected from
                your repo, so this is optional.
              </p>
            )}
          </Section>

          <Section
            label="Advanced (optional)"
            title="Supabase — Management API token (legacy)"
            description="Only if you can't create a Postgres role. Account-level token — prefer the read-only role above. Not needed for Lovable Cloud."
          >
            {supabaseFormProjects.length > 0 ? (
              <ReconnectForm projects={supabaseFormProjects} />
            ) : (
              <p className="text-sm text-fog-500">Optional — not needed when the backend is auto-detected.</p>
            )}
          </Section>

          <Section
            label="Active testing"
            title="Consent for the multi-agent pen test"
            description="Kelp only runs live security probes after you grant consent for this project. Revoke any time — new campaigns will refuse immediately."
          >
            <ActiveTestingConsentForm
              consents={consents}
              copy={CONSENT_V3_TEXT}
              version={CONSENT_VERSION_LATEST}
            />
          </Section>
        </div>

        <div className="mt-14 rounded-2xl border border-aqua-600/30 bg-aqua-500/[0.04] px-6 py-5 text-sm text-fog-200">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-aqua-300">
            Ready to run?
          </div>
          <p className="text-fog-300">
            Once the sections above are filled, open{" "}
            <Link
              href={`/dashboard?project=${current.id}`}
              className="text-aqua-400 underline decoration-aqua-600/40 underline-offset-2 hover:text-aqua-300"
            >
              Overview
            </Link>{" "}
            and click <span className="font-medium text-fog-100">Run active pen test</span>.
          </p>
        </div>
      </main>
    </>
  );
}

function Section({
  label,
  title,
  description,
  children,
}: {
  label: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-fog-500">
        {label}
      </div>
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {description && (
        <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-fog-400">{description}</p>
      )}
      <div className="mt-5">{children}</div>
    </section>
  );
}
