// Settings — account-only. Everything project-scoped lives under Configuration.

import Link from "next/link";
import { PageHero } from "@/components/dashboard/PageHeader";
import { getServerSupabase } from "@/lib/supabase/server";

export default async function SettingsPage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="px-8 pb-24 pt-14">
      <PageHero
        label="§ Settings · workspace"
        title="Settings."
        description="Account-level details. Looking for pentest inputs (Supabase, consent, app URL, test accounts)? Those live under Configuration."
      />

      <div className="mt-14 space-y-12">
        <Section label="§ Account" title="Sign-in details">
          <dl className="border-y border-[color:var(--color-hair)] divide-y divide-[color:var(--color-hair)]">
            <div className="flex items-center justify-between py-4">
              <dt className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
                Email
              </dt>
              <dd className="font-mono text-[13px] text-[color:var(--color-paper-50)]">
                {user?.email ?? "—"}
              </dd>
            </div>
          </dl>
        </Section>

        <Section
          label="§ Per project"
          title="Configure a project"
          description="Data sources, consent, app URL, and test accounts are per-project — configure them from the Configuration route."
        >
          <Link
            href="/dashboard/configuration"
            className="inline-flex items-center gap-2 border border-[color:var(--color-hair-strong)] px-4 py-2.5 text-[13px] text-[color:var(--color-paper-50)] transition-colors hover:border-[color:var(--color-paper-300)]"
          >
            Open Configuration <span aria-hidden>→</span>
          </Link>
        </Section>
      </div>
    </div>
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
      <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]">
        {label}
      </div>
      <h2 className="font-display mt-3 text-[26px] leading-[1.15] text-[color:var(--color-paper-50)]">
        {title}
      </h2>
      {description && (
        <p className="mt-3 max-w-xl text-[13.5px] leading-[1.65] text-[color:var(--color-paper-400)]">
          {description}
        </p>
      )}
      <div className="mt-6">{children}</div>
    </section>
  );
}
