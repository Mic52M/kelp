"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";
import { signOut } from "@/app/login/actions";

const NAV = [
  { label: "Overview", href: "/dashboard" },
  { label: "Findings", href: "/dashboard/findings" },
  { label: "Projects", href: "/dashboard/projects" },
  { label: "Settings", href: "/dashboard/settings" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-line/70 bg-ink-900/40 px-4 py-5 lg:flex">
      <Link href="/">
        <Logo />
      </Link>

      <div className="mt-8 px-1 text-xs font-medium uppercase tracking-wider text-fog-500">
        Workspace
      </div>
      <nav className="mt-3 space-y-1">
        {NAV.map((n) => {
          const active = n.href === "/dashboard" ? pathname === n.href : pathname.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`flex w-full items-center rounded-lg px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-ink-700/60 text-fog-50"
                  : "text-fog-400 hover:bg-white/[0.02] hover:text-fog-50"
              }`}
            >
              {n.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto space-y-3">
        <Link
          href="/dashboard/billing"
          className="block rounded-xl border border-aqua-600/30 bg-aqua-500/[0.06] p-3 text-xs transition-colors hover:border-aqua-600/50"
        >
          <div className="font-medium text-fog-50">Free plan</div>
          <p className="mt-1 text-fog-400">Upgrade for continuous cover and auto-fix.</p>
          <span className="mt-2 block w-full rounded-md bg-gradient-to-r from-aqua-400 to-aqua-600 px-2 py-1.5 text-center font-medium text-ink-950">
            Upgrade
          </span>
        </Link>

        <form action={signOut}>
          <button
            type="submit"
            className="w-full rounded-lg px-3 py-2 text-left text-xs text-fog-500 transition-colors hover:text-fog-50"
          >
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
