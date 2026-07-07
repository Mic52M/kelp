import { PageHeader, PageHero } from "@/components/dashboard/PageHeader";
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
import { loadActiveTestConsent, findUserEmail, findOrgName } from "@kelp/worker";

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
    let consentedByEmail: string | null = null;
    let orgName: string | null = null;
    if (row) {
      // Resolve the signer + org lazily so unsigned projects don't pay for the join.
      [consentedByEmail, orgName] = await Promise.all([
        findUserEmail(row.consentedBy),
        findOrgName(row.orgId),
      ]);
    }
    consents.push({
      projectId: p.id,
      projectName: p.name,
      status: row ? "granted" : "none",
      version: row?.consentVersion ?? null,
      consentedAt: row?.consentedAt.toISOString() ?? null,
      consentedByEmail,
      orgName,
    });
  }

  // Active-pentest config (#27): app_base_url + presence of the two encrypted
  // test-account credentials. We only surface whether they're set (never the
  // values). RLS keeps this scoped to the user's org.
  const { data: rawProjectRows } = await supabase
    .from("projects")
    .select("id, name, app_base_url");
  const projectAppRows =
    ((rawProjectRows ?? []) as Array<{ id: string; name: string; app_base_url: string | null }>);
  const { data: rawCredRows } = await supabase
    .from("project_credentials")
    .select("project_id, token_kind")
    .in("token_kind", ["app_test_account_a", "app_test_account_b"]);
  const credRows =
    ((rawCredRows ?? []) as Array<{ project_id: string; token_kind: string }>);
  const hasA = new Set(
    credRows.filter((c) => c.token_kind === "app_test_account_a").map((c) => c.project_id),
  );
  const hasB = new Set(
    credRows.filter((c) => c.token_kind === "app_test_account_b").map((c) => c.project_id),
  );
  const pentestConfigs: ProjectPentestConfig[] = projectAppRows.map((r) => ({
    projectId: r.id,
    projectName: r.name,
    appBaseUrl: r.app_base_url,
    hasAccountA: hasA.has(r.id),
    hasAccountB: hasB.has(r.id),
  }));

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
            title="Supabase — read-only role (recommended)"
            description="Least-privilege: a per-project Postgres role scoped to pg_catalog + information_schema. Kelp cannot read your application data through this credential."
          >
            <SupabaseReadonlyForm projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
          </Section>

          <Section
            label="Data sources"
            title="Supabase — Management API token (legacy)"
            description="Only if you can't create a Postgres role. This is an account-level token — prefer the read-only role above."
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
              copy={CONSENT_V3_TEXT}
              version={CONSENT_VERSION_LATEST}
            />
          </Section>

          <Section
            label="Active testing"
            title="Where to probe"
            description="The active pen test needs a deployed URL to send requests to, plus two test-account credentials it can use as identity A and identity B for cross-account probes. Credentials are stored encrypted; only their presence is shown here."
          >
            <ActivePentestConfigForm projects={pentestConfigs} />
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
