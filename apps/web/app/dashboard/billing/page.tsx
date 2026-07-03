import { PageHeader } from "@/components/dashboard/PageHeader";
import { getServerSupabase } from "@/lib/supabase/server";

const TIERS = [
  {
    name: "Free",
    price: "€0",
    tagline: "One full scan, report only.",
    features: ["1 project", "All checks", "Findings report"],
    current: true,
  },
  {
    name: "Starter",
    price: "€29",
    tagline: "Continuous cover for your app.",
    features: ["1 project", "Continuous scanning", "Auto-fix (RLS & secrets)", "Re-scan on push"],
    highlight: true,
  },
  {
    name: "Agency",
    price: "€89",
    tagline: "For studios shipping many apps.",
    features: ["Up to 5 projects", "Everything in Starter", "Priority review", "Email alerts"],
  },
];

export default async function BillingPage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      <PageHeader title="Billing" email={user?.email} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <div className="mb-6">
          <h2 className="text-lg font-medium">Choose your plan</h2>
          <p className="mt-1 text-sm text-fog-400">
            You’re on the Free plan. Upgrade for continuous scanning and one-click fixes.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {TIERS.map((t) => (
            <div
              key={t.name}
              className={`relative rounded-2xl p-6 ${
                t.highlight
                  ? "border border-aqua-600/50 bg-gradient-to-b from-aqua-500/[0.08] to-transparent"
                  : "glass"
              }`}
            >
              {t.current && (
                <div className="absolute -top-3 left-6 rounded-full border border-line bg-ink-800 px-2.5 py-0.5 text-xs text-fog-300">
                  Current
                </div>
              )}
              <div className="text-sm text-fog-300">{t.name}</div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-4xl font-semibold">{t.price}</span>
                <span className="text-sm text-fog-400">/mo</span>
              </div>
              <div className="mt-1 text-sm text-fog-400">{t.tagline}</div>
              <ul className="mt-5 space-y-2.5 text-sm">
                {t.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-fog-300">
                    <span className="text-aqua-400">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <button
                disabled={t.current}
                className={`mt-6 w-full rounded-lg px-4 py-2.5 text-center text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-40 ${
                  t.highlight
                    ? "bg-gradient-to-r from-aqua-400 to-aqua-600 text-ink-950"
                    : "border border-line bg-ink-800 text-fog-50"
                }`}
              >
                {t.current ? "Current plan" : "Upgrade"}
              </button>
            </div>
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-fog-500">
          Secure checkout via Stripe — coming online shortly.
        </p>
      </main>
    </>
  );
}
