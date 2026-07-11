// Editorial-industrial button primitive.
//
// primary = the single kelp-signal action per view (Start / Run / Save).
// secondary = ghost with hairline border for reversible alternates.
// tertiary = text-only, for low-emphasis links inside prose.
//
// No gradients, no shadows, no rounded pills. Square-cornered, tight.

import { forwardRef, type ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "tertiary";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 font-medium transition-colors " +
  "focus-visible:outline focus-visible:outline-1 focus-visible:outline-[color:var(--color-signal)] focus-visible:outline-offset-2 " +
  "disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-[color:var(--color-signal)] text-[color:var(--color-signal-ink)] hover:bg-[color:var(--color-paper-50)]",
  secondary:
    "border border-[color:var(--color-hair-strong)] bg-transparent text-[color:var(--color-paper-50)] hover:border-[color:var(--color-paper-300)]",
  tertiary:
    "text-[color:var(--color-paper-300)] hover:text-[color:var(--color-paper-50)]",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] rounded-[2px]",
  md: "h-9 px-4 text-[13px] rounded-[2px]",
  lg: "h-11 px-5 text-sm rounded-[2px]",
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
