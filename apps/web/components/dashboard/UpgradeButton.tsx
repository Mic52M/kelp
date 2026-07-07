"use client";

// Client wrapper around the Stripe checkout server action (issue #10). Needs
// to be a client component because we use useActionState for pending/error UI.

import { useActionState } from "react";
import { startCheckoutAction } from "@/app/dashboard/billing/actions";

export function UpgradeButton({
  tier,
  current,
  disabled,
  highlight,
}: {
  tier: "starter" | "agency";
  current: boolean;
  disabled?: boolean;
  highlight?: boolean;
}) {
  const [state, action, pending] = useActionState<
    { ok: boolean; message: string } | null,
    FormData
  >(startCheckoutAction, null);

  const base =
    "mt-6 w-full rounded-lg px-4 py-2.5 text-center text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-40";
  const style = highlight
    ? "bg-gradient-to-r from-aqua-400 to-aqua-600 text-ink-950"
    : "border border-line bg-ink-800 text-fog-50";

  return (
    <form action={action}>
      <input type="hidden" name="tier" value={tier} />
      <button type="submit" disabled={current || disabled || pending} className={`${base} ${style}`}>
        {current ? "Current plan" : pending ? "Redirecting…" : "Upgrade"}
      </button>
      {state?.ok === false && <p className="mt-2 text-xs text-crit">{state.message}</p>}
    </form>
  );
}
