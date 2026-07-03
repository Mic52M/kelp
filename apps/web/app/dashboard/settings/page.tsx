import { PageHeader } from "@/components/dashboard/PageHeader";
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
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8 space-y-6">
        <section className="glass rounded-2xl p-6">
          <h2 className="text-base font-medium">Account</h2>
          <div className="mt-4 flex items-center justify-between rounded-lg border border-line/70 bg-ink-900/50 px-4 py-3">
            <span className="text-sm text-fog-400">Email</span>
            <span className="text-sm text-fog-100">{user?.email ?? "—"}</span>
          </div>
        </section>

        <section className="glass rounded-2xl p-6">
          <h2 className="text-base font-medium">Reconnect Supabase</h2>
          <p className="mt-1 max-w-md text-sm text-fog-400">
            Rotated or revoked your token? Paste a fresh Management API token to restore the
            RLS scan for a project.
          </p>
          <div className="mt-5">
            <ReconnectForm projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
          </div>
        </section>
      </main>
    </>
  );
}
