"use server";

// Server actions for the billing page (issue #10). The Upgrade buttons on
// /dashboard/billing POST here; we mint a Stripe Checkout Session for the
// picked tier and redirect the user to Stripe's hosted page.

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { ensureTenant } from "@/lib/tenant";
import {
  StripeNotConfiguredError,
  startCheckoutForOrg,
  stripeConfigured,
} from "@kelp/worker";
import { track, identityForUser } from "@/lib/analytics";

/**
 * Start a Stripe Checkout Session for `tier` and redirect the user to the
 * hosted checkout page. Returns a friendly error state when Stripe isn't
 * configured (dev without keys) so the button doesn't 500.
 */
export async function startCheckoutAction(
  _prev: { ok: boolean; message: string } | null,
  formData: FormData,
): Promise<{ ok: boolean; message: string } | null> {
  const tierRaw = String(formData.get("tier") ?? "");
  if (tierRaw !== "starter" && tierRaw !== "agency") {
    return { ok: false, message: "Pick a paid tier to upgrade to." };
  }

  if (!stripeConfigured()) {
    return { ok: false, message: "Stripe isn't configured on this deployment yet — check back soon." };
  }

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, message: "You're signed out." };

  const { orgId } = await ensureTenant({ id: user.id, email: user.email });

  // Build absolute success/cancel URLs from the incoming request — this works
  // in local dev, preview, and prod without an env-var round-trip.
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const origin = `${proto}://${host}`;

  let checkoutUrl: string;
  try {
    const { url } = await startCheckoutForOrg({
      orgId,
      email: user.email,
      tier: tierRaw,
      successUrl: `${origin}/dashboard/billing?checkout=success`,
      cancelUrl: `${origin}/dashboard/billing?checkout=cancelled`,
    });
    checkoutUrl = url;
    const ident = identityForUser(user);
    if (ident) {
      track(ident.distinctId, "plan.upgrade_started", { tier: tierRaw, org_id: orgId });
    }
  } catch (e) {
    if (e instanceof StripeNotConfiguredError) {
      return { ok: false, message: e.message };
    }
    console.error("stripe checkout failed:", e instanceof Error ? e.message : e);
    return { ok: false, message: "Checkout failed to start. Try again in a moment." };
  }

  redirect(checkoutUrl);
}
