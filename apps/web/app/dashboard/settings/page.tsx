import { PageHeader, PageHero } from "@/components/dashboard/PageHeader";
import { ReconnectForm } from "@/components/dashboard/ReconnectForm";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadProjects } from "@/lib/data";

export default async function SettingsPage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const projects = (await loadProjects()).filter((p) => p.supabaseRef);

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
