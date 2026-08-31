"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Logo } from "@/components/Logo";
import { signOut } from "@/app/login/actions";

const NAV = [
  { label: "Overview", href: "/dashboard" },
  { label: "Findings", href: "/dashboard/findings" },
  { label: "Projects", href: "/dashboard/projects" },
  { label: "Configuration", href: "/dashboard/configuration" },
  { label: "Settings", href: "/dashboard/settings" },
];

export function Sidebar() {
  const pathname = usePathname();
  // Carry the selected project across sidebar navigation so the switcher choice
  // survives when the user jumps Overview → Findings → back. Only propagate to
  // pages that actually read it (Overview + Findings today).
  const searchParams = useSearchParams();
  const projectParam = searchParams.get("project");
  const carriesProject = (href: string) =>
    href === "/dashboard" ||
    href === "/dashboard/findings" ||
    href === "/dashboard/configuration";
  const hrefWithProject = (href: string) =>
    projectParam && carriesProject(href) ? `${href}?project=${projectParam}` : href;

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-line/70 bg-ink-900/40 px-5 py-6 lg:flex">
      <Link href="/" className="mb-10">
        <Logo />
      </Link>

      <div className="mb-3 px-2 text-[11px] font-medium uppercase tracking-[0.14em] text-fog-500">
        Workspace
      </div>
      <nav className="space-y-0.5">
        {NAV.map((n) => {
          const active = n.href === "/dashboard" ? pathname === n.href : pathname.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={hrefWithProject(n.href)}
              className={`relative flex w-full items-center rounded-lg px-2.5 py-2 text-sm transition-colors ${
                active
                  ? "text-fog-50"
                  : "text-fog-400 hover:text-fog-50"
              }`}
            >
              {active && (
                <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-aqua-400" />
              )}
              <span className={active ? "pl-2 font-medium" : "pl-2"}>{n.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto space-y-3">
        {/* OSS-mode: replaced the "Upgrade" card with a repo/docs pointer.
            Continuous-cover framing is unchanged; the paid tier just isn't
            surfaced here. */}
        <a
          href="https://github.com/Mic52M/kelp"
          target="_blank"
          rel="noreferrer noopener"
          className="block rounded-xl border border-aqua-600/30 bg-aqua-500/[0.06] p-3 text-xs transition-colors hover:border-aqua-600/50"
        >
          <div className="font-medium text-fog-50">Kelp is open source</div>
          <p className="mt-1 text-fog-400">MIT-licensed. Contribute a detection, or run the CLI locally.</p>
          <span className="mt-2 block w-full rounded-md border border-aqua-500/40 px-2 py-1.5 text-center font-medium text-aqua-100">
            View on GitHub ↗
          </span>
        </a>

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
