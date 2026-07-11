"use client";

import { useActionState } from "react";
import { buttonClasses } from "@/components/Button";
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

  return (
    <form action={action}>
      <input type="hidden" name="tier" value={tier} />
      <button
        type="submit"
        disabled={current || disabled || pending}
        className={buttonClasses(
          highlight ? "primary" : "secondary",
          "md",
          "mt-6 w-full",
        )}
      >
        {current ? "Current plan" : pending ? "Redirecting…" : "Upgrade"}
      </button>
      {state?.ok === false && (
        <p className="mt-2 font-mono text-[11px] text-[color:var(--color-sev-crit)]">
          {state.message}
        </p>
      )}
    </form>
  );
}
