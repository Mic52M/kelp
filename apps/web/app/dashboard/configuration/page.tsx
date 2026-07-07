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
          <Section
            label="Data sources"
            title="Supabase — read-only role (recommended)"
            description="Least-privilege: Kelp connects with the standard Session-pooler URL and switches to a kelp_readonly role you install once. No application data is ever read through this credential."
          >
            {supabaseFormProjects.length > 0 ? (
              <SupabaseReadonlyForm projects={supabaseFormProjects} />
            ) : (
              <p className="text-sm text-fog-500">
                This project isn't linked to a Supabase database yet. Connect one from Onboarding to
                enable read-only credentials.
              </p>
            )}
          </Section>

          <Section
            label="Data sources"
            title="Supabase — Management API token (legacy)"
            description="Only if you can't create a Postgres role. This is an account-level token — prefer the read-only role above."
          >
            {supabaseFormProjects.length > 0 ? (
              <ReconnectForm projects={supabaseFormProjects} />
            ) : (
              <p className="text-sm text-fog-500">No Supabase project linked.</p>
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

          <Section
            label="Active testing"
            title="Where to probe"
            description="The active pen test signs in to your Supabase as two test accounts (A + B) and probes cross-account reads through PostgREST. The deployed app URL is optional today — it'll be used once the four Stage-B specialists (auth-bypass, injection, SSRF, weak-crypto) come online with real endpoint discovery."
          >
            <ActivePentestConfigForm projects={pentestConfigs} />
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
