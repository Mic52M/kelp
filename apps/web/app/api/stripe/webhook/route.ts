// Stripe webhook endpoint (issue #10). Server-to-server: no user session, no
// middleware auth — trust the HMAC signature and nothing else. Non-matching
// events (invoice.paid etc.) return 200 with "ignored" so Stripe doesn't
// retry indefinitely.

import { NextResponse, type NextRequest } from "next/server";
import {
  StripeNotConfiguredError,
  handleStripeWebhookEvent,
  verifyStripeWebhookSignature,
} from "@kelp/worker";

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Read the RAW body — the signature is over the exact bytes Stripe sent.
  // Any re-parse-and-serialize would break constructEvent().
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  let event;
  try {
    event = verifyStripeWebhookSignature(rawBody, signature);
  } catch (e) {
    if (e instanceof StripeNotConfiguredError) {
      // Deployment isn't fully wired to Stripe yet. Return 503 so Stripe backs
      // off; retrying won't help until STRIPE_WEBHOOK_SECRET is set.
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "invalid signature" },
      { status: 401 },
    );
  }

  try {
    const result = await handleStripeWebhookEvent(event);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("stripe webhook handler failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
