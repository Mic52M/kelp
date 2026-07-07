// Post-#7 refactor: Settings is now account-only. Everything project-scoped
// (Supabase read-only credentials, Management API token, active-testing
// consent, deployed app URL + test accounts) moved to /dashboard/configuration
// so the tester finds "the pentest inputs" in a page that actually says so.

import Link from "next/link";
import { PageHeader, PageHero } from "@/components/dashboard/PageHeader";
import { getServerSupabase } from "@/lib/supabase/server";

export default async function SettingsPage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      <PageHeader title="Settings" email={user?.email} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-8 py-14">
        <PageHero
          label="Workspace"
          title="Settings"
          description="Account-level details. Looking for pentest inputs (Supabase, consent, app URL, test accounts)? Those live under Configuration."
        />

        <div className="mt-12 space-y-8">
          <Section label="Account" title="Sign-in details">
            <div className="flex items-center justify-between rounded-xl border border-line/70 bg-ink-900/40 px-5 py-3.5">
              <span className="text-sm text-fog-400">Email</span>
              <span className="text-sm text-fog-100">{user?.email ?? "—"}</span>
            </div>
          </Section>

          <Section
            label="Per project"
            title="Configure a project"
            description="Data sources, consent, app URL, and test accounts are per-project — configure them from the Configuration route."
          >
            <Link
              href="/dashboard/configuration"
              className="inline-flex items-center gap-2 rounded-lg border border-line/70 bg-ink-900/40 px-4 py-2.5 text-sm text-fog-100 transition-colors hover:border-aqua-600/50"
            >
              Open Configuration <span aria-hidden>→</span>
            </Link>
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
