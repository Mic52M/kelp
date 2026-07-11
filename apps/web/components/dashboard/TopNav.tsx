"use client";

// Global top nav — replaces the old sidebar shell.
// Kelp logo · primary tabs · sign-out. The project selector + per-page
// actions live in each page's own sub-header (context bar), Linear-style.

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Logo } from "@/components/Logo";
import { signOut } from "@/app/login/actions";

const NAV: { label: string; href: string }[] = [
  { label: "Overview",      href: "/dashboard" },
  { label: "Findings",      href: "/dashboard/findings" },
  { label: "Projects",      href: "/dashboard/projects" },
  { label: "Configuration", href: "/dashboard/configuration" },
  { label: "Billing",       href: "/dashboard/billing" },
  { label: "Settings",      href: "/dashboard/settings" },
];

const CARRIES_PROJECT = new Set([
  "/dashboard",
  "/dashboard/findings",
  "/dashboard/configuration",
]);

export function TopNav({ email }: { email?: string | null }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const projectParam = params.get("project");

  const hrefFor = (href: string) =>
    projectParam && CARRIES_PROJECT.has(href) ? `${href}?project=${projectParam}` : href;

  return (
    <div className="sticky top-0 z-30 border-b border-[color:var(--color-hair)] bg-[color:var(--color-ink-950)]/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1240px] items-center gap-10 px-8 py-4">
        <Link href="/" aria-label="Kelp home" className="shrink-0">
          <Logo />
        </Link>

        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {NAV.map((n) => {
            const active =
              n.href === "/dashboard"
                ? pathname === n.href
                : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={hrefFor(n.href)}
                className={`relative whitespace-nowrap px-3 py-2 text-[13px] transition-colors ${
                  active
                    ? "text-[color:var(--color-paper-50)]"
                    : "text-[color:var(--color-paper-400)] hover:text-[color:var(--color-paper-50)]"
                }`}
              >
                {n.label}
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-x-3 -bottom-[17px] h-px bg-[color:var(--color-signal)]"
                  />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-5 md:flex">
          {email && (
            <span className="font-mono text-[11.5px] text-[color:var(--color-paper-400)]">
              {email}
            </span>
          )}
          <form action={signOut}>
            <button
              type="submit"
              className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)] transition-colors hover:text-[color:var(--color-paper-50)]"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
