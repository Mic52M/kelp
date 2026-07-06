import { PageHeader, PageHero } from "@/components/dashboard/PageHeader";
import { ReconnectForm } from "@/components/dashboard/ReconnectForm";
import {
  ActiveTestingConsentForm,
  type ProjectConsent,
} from "@/components/dashboard/ActiveTestingConsentForm";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadProjects } from "@/lib/data";
import { CONSENT_V2_TEXT, CONSENT_VERSION_LATEST } from "@kelp/core";
import { loadActiveTestConsent } from "@kelp/worker";

export default async function SettingsPage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const allProjects = await loadProjects();
  const projects = allProjects.filter((p) => p.supabaseRef);

  // Consent status per project — small N (projects per org), so sequential is fine.
  const consents: ProjectConsent[] = [];
  for (const p of allProjects) {
    const row = await loadActiveTestConsent(p.id);
    consents.push({
      projectId: p.id,
      projectName: p.name,
      status: row ? "granted" : "none",
      version: row?.consentVersion ?? null,
      consentedAt: row?.consentedAt.toISOString() ?? null,
    });
  }

  return (
    <>
      <PageHeader title="Settings" email={user?.email} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-8 py-14">
        <PageHero
          label="Workspace"
          title="Settings"
          description="Manage your account and reconnect data sources when tokens rotate."
        />

        <div className="mt-12 space-y-8">
          <Section label="Account" title="Sign-in details">
            <div className="flex items-center justify-between rounded-xl border border-line/70 bg-ink-900/40 px-5 py-3.5">
              <span className="text-sm text-fog-400">Email</span>
              <span className="text-sm text-fog-100">{user?.email ?? "—"}</span>
            </div>
          </Section>

          <Section
            label="Data sources"
            title="Reconnect Supabase"
            description="Rotated or revoked your token? Paste a fresh Management API token to restore the RLS scan for a project."
          >
            <ReconnectForm projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
          </Section>

          <Section
            label="Active testing"
            title="Consent for the multi-agent pen test"
            description="Kelp only runs live security probes against a project after you grant consent for that specific project. Revoke any time — new campaigns will refuse immediately."
          >
            <ActiveTestingConsentForm
              consents={consents}
              copy={CONSENT_V2_TEXT}
              version={CONSENT_VERSION_LATEST}
            />
          </Section>
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
