import { PageHeader } from "@/components/dashboard/PageHeader";
import { getServerSupabase } from "@/lib/supabase/server";
import { ensureTenant } from "@/lib/tenant";
import { loadOrgPlan, stripeConfigured } from "@kelp/worker";
import { UpgradeButton } from "@/components/dashboard/UpgradeButton";

type BillingSearchParams = { checkout?: string };

const TIERS = [
  {
    tier: "free" as const,
    name: "Free",
    price: "€0",
    tagline: "One full scan, report only.",
    features: ["1 project", "All checks", "Findings report"],
  },
  {
    tier: "starter" as const,
    name: "Starter",
    price: "€29",
    tagline: "Continuous cover for your app.",
    features: ["5 projects", "Continuous scanning", "Auto-fix (RLS & secrets)", "Re-scan on push"],
    highlight: true,
  },
  {
    tier: "agency" as const,
    name: "Agency",
    price: "€89",
    tagline: "For studios shipping many apps.",
    features: ["25 projects", "Everything in Starter", "Priority review", "Email alerts"],
  },
];

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<BillingSearchParams>;
}) {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  // Look up the current plan so the "Current" badge and disabled state are real.
  let currentPlan: "free" | "starter" | "agency" = "free";
  if (user?.email) {
    const { orgId } = await ensureTenant({ id: user.id, email: user.email });
    currentPlan = await loadOrgPlan(orgId);
  }
  const stripeReady = stripeConfigured();
  const sp = await searchParams;

  return (
    <>
      <PageHeader title="Billing" email={user?.email} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <div className="mb-6">
          <h2 className="text-lg font-medium">Choose your plan</h2>
          <p className="mt-1 text-sm text-fog-400">
            You're on the{" "}
            <span className="text-fog-200">{TIERS.find((t) => t.tier === currentPlan)?.name}</span>{" "}
            plan.
            {currentPlan === "free" && " Upgrade for continuous scanning and one-click fixes."}
          </p>
        </div>

        {sp.checkout === "success" && (
          <div className="mb-6 rounded-xl border border-aqua-600/40 bg-aqua-500/[0.06] px-4 py-3 text-sm text-aqua-300">
            Payment received. Your plan will update shortly — refresh if it doesn't appear right away.
          </div>
        )}
        {sp.checkout === "cancelled" && (
          <div className="mb-6 rounded-xl border border-line/70 bg-ink-900/40 px-4 py-3 text-sm text-fog-300">
            Checkout cancelled — no charge was made.
          </div>
        )}
        {!stripeReady && (
          <div className="mb-6 rounded-xl border border-line/70 bg-ink-900/40 px-4 py-3 text-sm text-fog-400">
            Stripe isn't configured on this deployment yet. Upgrade buttons are inactive.
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          {TIERS.map((t) => {
            const current = currentPlan === t.tier;
            return (
              <div
                key={t.tier}
                className={`relative rounded-2xl p-6 ${
                  t.highlight
                    ? "border border-aqua-600/50 bg-gradient-to-b from-aqua-500/[0.08] to-transparent"
                    : "glass"
                }`}
              >
                {current && (
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
                {t.tier === "free" ? (
                  <button
                    disabled
                    className="mt-6 w-full rounded-lg border border-line bg-ink-800 px-4 py-2.5 text-center text-sm font-medium text-fog-50 opacity-40"
                  >
                    Free forever
                  </button>
                ) : (
                  <UpgradeButton
                    tier={t.tier}
                    current={current}
                    disabled={!stripeReady}
                    highlight={t.highlight}
                  />
                )}
              </div>
            );
          })}
        </div>

        <p className="mt-6 text-center text-xs text-fog-500">
          Secure checkout via Stripe.
        </p>
      </main>
    </>
  );
}
