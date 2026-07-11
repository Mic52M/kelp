import { PageHero } from "@/components/dashboard/PageHeader";
import { getServerSupabase } from "@/lib/supabase/server";
import { ensureTenant } from "@/lib/tenant";
import { loadOrgPlan, stripeConfigured } from "@kelp/worker";
import { UpgradeButton } from "@/components/dashboard/UpgradeButton";

type BillingSearchParams = { checkout?: string };

const TIERS = [
  {
    tier: "free" as const,
    name: "Free",
    price: "0",
    tagline: "One full scan, report only.",
    features: ["1 project", "All checks", "Findings report"],
  },
  {
    tier: "starter" as const,
    name: "Starter",
    price: "29",
    tagline: "Continuous cover for your app.",
    features: ["5 projects", "Continuous scanning", "Auto-fix (RLS & secrets)", "Re-scan on push"],
    highlight: true,
  },
  {
    tier: "agency" as const,
    name: "Agency",
    price: "89",
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let currentPlan: "free" | "starter" | "agency" = "free";
  if (user?.email) {
    const { orgId } = await ensureTenant({ id: user.id, email: user.email });
    currentPlan = await loadOrgPlan(orgId);
  }
  const stripeReady = stripeConfigured();
  const sp = await searchParams;

  return (
    <div className="px-8 pb-24 pt-14">
      <PageHero
        label={`§ Billing · ${TIERS.find((t) => t.tier === currentPlan)?.name}`}
        title="Choose your plan."
        description={
          currentPlan === "free"
            ? "You're on the Free plan. Upgrade for continuous scanning and one-click fixes."
            : "You're on a paid plan. Manage seats and cadence below."
        }
      />

      <div className="mt-10 space-y-3">
        {sp.checkout === "success" && (
          <Notice tone="signal">
            Payment received. Your plan will update shortly — refresh if it doesn't appear right away.
          </Notice>
        )}
        {sp.checkout === "cancelled" && (
          <Notice tone="muted">Checkout cancelled — no charge was made.</Notice>
        )}
        {!stripeReady && (
          <Notice tone="muted">
            Stripe isn't configured on this deployment yet. Upgrade buttons are inactive.
          </Notice>
        )}
      </div>

      <div className="mt-14 divide-y divide-[color:var(--color-hair)] border-y border-[color:var(--color-hair)]">
        {TIERS.map((t) => {
          const current = currentPlan === t.tier;
          return (
            <div
              key={t.tier}
              className="grid grid-cols-1 gap-8 py-10 lg:grid-cols-12 lg:items-start lg:gap-10"
            >
              <div className="lg:col-span-3">
                <div className="flex items-center gap-3">
                  <span className="font-display text-[28px] leading-none text-[color:var(--color-paper-50)]">
                    {t.name}
                  </span>
                  {t.highlight && (
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-signal)]">
                      Recommended
                    </span>
                  )}
                  {current && (
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-paper-400)]">
                      Current
                    </span>
                  )}
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="font-display tabular text-[44px] leading-none text-[color:var(--color-paper-50)]">
                    €{t.price}
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
                    /mo
                  </span>
                </div>
              </div>
              <div className="lg:col-span-6">
                <p className="text-[14.5px] leading-[1.6] text-[color:var(--color-paper-300)]">
                  {t.tagline}
                </p>
                <ul className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
                  {t.features.map((f) => (
                    <li
                      key={f}
                      className="flex items-start gap-2 font-mono text-[12.5px] text-[color:var(--color-paper-300)]"
                    >
                      <span
                        aria-hidden
                        className="mt-[7px] inline-block h-px w-3 bg-[color:var(--color-signal-dim)]"
                      />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="lg:col-span-3">
                {t.tier === "free" ? (
                  <button
                    disabled
                    className="mt-1 w-full border border-[color:var(--color-hair)] px-4 py-2.5 text-center font-mono text-[11.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]"
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
            </div>
          );
        })}
      </div>

      <p className="mt-10 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
        Secure checkout via Stripe
      </p>
    </div>
  );
}

function Notice({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "signal" | "muted";
}) {
  const color =
    tone === "signal" ? "var(--color-signal)" : "var(--color-paper-300)";
  return (
    <div
      className="border-l px-4 py-3 text-[13.5px] leading-relaxed"
      style={{ borderColor: color, color }}
    >
      {children}
    </div>
  );
}
