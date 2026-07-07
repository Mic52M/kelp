// Stripe subscription billing (issue #10).
//
// This module owns every touchpoint with Stripe: the Checkout session that
// starts an upgrade, and the webhook handler that flips `orgs.plan` when the
// subscription state changes. It stays server-side (worker package) so the
// secret key never crosses into the client bundle.
//
// Env-agnostic: if STRIPE_SECRET_KEY is unset (local dev, CI) every export
// short-circuits to a clear error rather than crashing the app — the rest of
// the product must remain runnable without a Stripe account.
//
// Data flow, upgrade:
//   1. User clicks Upgrade on /dashboard/billing.
//   2. Server action calls startCheckoutForOrg(orgId, tier) here.
//   3. We ensure the org has a Stripe Customer (create + persist customer_id
//      to orgs.stripe_customer_id on first use), then create a Checkout
//      Session with the plan's price id.
//   4. User pays; Stripe redirects to /dashboard/billing?success=1.
//   5. Stripe delivers `checkout.session.completed` and later
//      `customer.subscription.updated|deleted` events to our webhook.
//   6. handleWebhookEvent() verifies the signature and updates orgs.plan.
//
// The webhook is the SOURCE OF TRUTH for plan changes — never trust the
// redirect. A user could close the browser before landing on our success
// page; the plan still activates when the webhook arrives.

import Stripe from "stripe";
import { getPool } from "./db.js";
import type { PlanTier } from "@kelp/core";

/** Error surfaced when a Stripe call is attempted without configured keys. */
export class StripeNotConfiguredError extends Error {
  readonly code = "STRIPE_NOT_CONFIGURED";
  constructor() {
    super("Stripe is not configured on this deployment. Set STRIPE_SECRET_KEY (and the price ids).");
    this.name = "StripeNotConfiguredError";
  }
}

let client: Stripe | null = null;
function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeNotConfiguredError();
  if (!client) {
    // Pin the API version so a Stripe rollout doesn't silently change response
    // shapes under us. `apiVersion` is deliberately a string — Stripe's typed
    // union across SDK versions is fragile enough that we let it widen here.
    client = new Stripe(key, { apiVersion: "2026-06-24.dahlia" });
  }
  return client;
}

/** True iff the deployment has Stripe keys — for graceful UI degradation. */
export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

// ─── Plan → Stripe price id ──────────────────────────────────────────────────
// Only paid tiers have prices; free needs no Checkout. Keeping the mapping
// local (not in @kelp/core) because Stripe price ids are deployment-specific
// and should live next to the code that speaks to Stripe.

type PaidTier = Exclude<PlanTier, "free">;

function priceIdFor(tier: PaidTier): string {
  const env = tier === "starter" ? "STRIPE_PRICE_STARTER" : "STRIPE_PRICE_AGENCY";
  const v = process.env[env];
  if (!v) throw new Error(`missing env ${env} (Stripe price id for tier=${tier})`);
  return v;
}

/** Reverse lookup: given a Stripe subscription's price id, which tier is it?
 *  Returns null if the price doesn't match any tier we know about (Stripe
 *  price id changed / manual back-office subscription / unknown product). */
export function tierForPrice(priceId: string): PaidTier | null {
  if (priceId === process.env.STRIPE_PRICE_STARTER) return "starter";
  if (priceId === process.env.STRIPE_PRICE_AGENCY) return "agency";
  return null;
}

// ─── Customer bootstrap ──────────────────────────────────────────────────────

/** Look up the org's `stripe_customer_id`, creating a Customer if the org has
 *  never checked out before. Idempotent: repeated calls for the same org
 *  return the same customer id. */
async function ensureStripeCustomer(orgId: string, email: string): Promise<string> {
  const { rows } = await getPool().query(
    `select stripe_customer_id from orgs where id = $1`,
    [orgId],
  );
  if (rows.length === 0) throw new Error(`org ${orgId} not found`);
  const existing = rows[0].stripe_customer_id as string | null;
  if (existing) return existing;

  const customer = await stripeClient().customers.create({
    email,
    metadata: { kelp_org_id: orgId },
  });
  await getPool().query(
    `update orgs set stripe_customer_id = $2 where id = $1`,
    [orgId, customer.id],
  );
  return customer.id;
}

// ─── Checkout ────────────────────────────────────────────────────────────────

export interface CheckoutInput {
  orgId: string;
  /** the org owner's email — Stripe pre-fills it on the checkout page */
  email: string;
  tier: PaidTier;
  /** where Stripe redirects on success (billing page with a success flag) */
  successUrl: string;
  /** where Stripe redirects on cancel */
  cancelUrl: string;
}

/** Start a Checkout Session for an upgrade. Returns the hosted-page URL the
 *  caller redirects the user to. */
export async function startCheckoutForOrg(input: CheckoutInput): Promise<{ url: string }> {
  const customerId = await ensureStripeCustomer(input.orgId, input.email);
  const session = await stripeClient().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceIdFor(input.tier), quantity: 1 }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    // Attach the org id to both the Session and the resulting Subscription so
    // the webhook can locate our org even if the customer is missing/renamed.
    client_reference_id: input.orgId,
    subscription_data: { metadata: { kelp_org_id: input.orgId } },
    allow_promotion_codes: true,
  });
  if (!session.url) throw new Error("Stripe returned a Session without a checkout URL");
  return { url: session.url };
}

// ─── Webhook ─────────────────────────────────────────────────────────────────

/**
 * Verify a Stripe webhook payload against STRIPE_WEBHOOK_SECRET and construct
 * the typed Event. Throws on a bad signature — the caller returns 401.
 * `rawBody` MUST be the exact bytes Stripe delivered (the signature is over
 * those bytes, not the parsed JSON).
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new StripeNotConfiguredError();
  if (!signatureHeader) throw new Error("missing stripe-signature header");
  return stripeClient().webhooks.constructEvent(rawBody, signatureHeader, secret);
}

/**
 * Apply the effect of one verified webhook event. Only reacts to the events
 * that change our authoritative state (subscription lifecycle); everything
 * else is a silent no-op. Idempotent — Stripe retries deliveries, and running
 * the same subscription.updated twice must not corrupt the plan.
 */
export async function handleWebhookEvent(event: Stripe.Event): Promise<{ applied: string }> {
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      const orgId = s.client_reference_id;
      // On completion, Stripe has created (or attached) a Subscription. Update
      // plan straight away rather than waiting for the subscription.updated
      // that follows — the user is watching the page.
      if (orgId && typeof s.subscription === "string") {
        await syncPlanFromSubscription(orgId, s.subscription);
      }
      return { applied: "checkout.session.completed" };
    }
    case "customer.subscription.updated":
    case "customer.subscription.created": {
      const sub = event.data.object as Stripe.Subscription;
      const orgId = (sub.metadata?.kelp_org_id as string | undefined) ?? null;
      if (orgId) {
        await applySubscription(orgId, sub);
      }
      return { applied: event.type };
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const orgId = (sub.metadata?.kelp_org_id as string | undefined) ?? null;
      if (orgId) {
        await getPool().query(`update orgs set plan = 'free' where id = $1`, [orgId]);
      }
      return { applied: "customer.subscription.deleted" };
    }
    default:
      return { applied: `ignored:${event.type}` };
  }
}

/** Fetch the subscription and apply its state to orgs.plan. */
async function syncPlanFromSubscription(orgId: string, subscriptionId: string): Promise<void> {
  const sub = await stripeClient().subscriptions.retrieve(subscriptionId);
  await applySubscription(orgId, sub);
}

/** Map a Stripe subscription to a plan tier and write it. An inactive/paused
 *  subscription reverts the org to free. */
async function applySubscription(orgId: string, sub: Stripe.Subscription): Promise<void> {
  const active = sub.status === "active" || sub.status === "trialing";
  if (!active) {
    await getPool().query(`update orgs set plan = 'free' where id = $1`, [orgId]);
    return;
  }
  const priceId = sub.items.data[0]?.price?.id;
  const tier = priceId ? tierForPrice(priceId) : null;
  if (!tier) {
    // Active subscription with an unrecognised price — don't guess. Log and
    // leave the plan alone so a human can investigate.
    console.error(`stripe: active subscription ${sub.id} has unrecognised price ${priceId}`);
    return;
  }
  await getPool().query(`update orgs set plan = $2 where id = $1`, [orgId, tier]);
}
