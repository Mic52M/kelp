// Unified button primitive — the single source of truth for CTAs.
//
// Three intents: `primary` (aqua gradient, one per screen — the action that
// commits/advances/pays), `secondary` (dark ghost-line, non-destructive
// alternates like Re-scan/Dismiss), `tertiary` (subtle text-only for
// low-emphasis affordances). `buttonClasses` is exported so <Link>/<a> can
// wear the same skin without a wrapper element.

import { forwardRef, type ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "tertiary";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aqua-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 " +
  "disabled:opacity-50 disabled:pointer-events-none";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-gradient-to-r from-aqua-400 to-aqua-600 text-ink-950 hover:opacity-90",
  secondary: "border border-line bg-ink-800 text-fog-50 hover:bg-ink-700",
  tertiary: "text-fog-300 hover:text-fog-50",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-3.5 py-2 text-sm",
  lg: "px-5 py-2.5 text-sm font-semibold",
};

export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  extra?: string,
): string {
  return `${BASE} ${VARIANT[variant]} ${SIZE[size]}${extra ? ` ${extra}` : ""}`;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, className, ...rest },
  ref,
) {
  return <button ref={ref} className={buttonClasses(variant, size, className)} {...rest} />;
});
