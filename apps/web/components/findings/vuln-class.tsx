import type { VulnClass } from "@/lib/types";

/**
 * Single source of truth for how each vulnerability class is presented in the
 * UI. Covers ALL classes the engine can produce (rls, secret, bola, auth,
 * injection, ssrf, exposure) — the old FindingCard only mapped three, so
 * autonomous-agent findings (auth / exposure / …) rendered `undefined`.
 *
 * `label` is the full human name, `short` a compact tag, `blurb` a one-line
 * plain-English description of the class for the expanded card.
 */
export interface VulnClassMeta {
  label: string;
  short: string;
  blurb: string;
}

export const VULN_CLASS_META: Record<VulnClass, VulnClassMeta> = {
  rls: {
    label: "Row Level Security",
    short: "RLS",
    blurb: "A Postgres row-security policy is missing or too permissive.",
  },
  secret: {
    label: "Exposed secret",
    short: "Secret",
    blurb: "A credential is hard-coded where it can leak.",
  },
  bola: {
    label: "Broken object authorization",
    short: "BOLA",
    blurb: "One user can reach another user's specific records.",
  },
  auth: {
    label: "Authentication / authorization",
    short: "Auth",
    blurb: "An endpoint's authentication or access check is missing or bypassable.",
  },
  injection: {
    label: "Injection",
    short: "Injection",
    blurb: "User input reaches an interpreter without proper sanitization.",
  },
  ssrf: {
    label: "Server-side request forgery",
    short: "SSRF",
    blurb: "The server can be tricked into making requests to attacker-chosen hosts.",
  },
  exposure: {
    label: "Data exposure",
    short: "Exposure",
    blurb: "Sensitive data or a weak configuration is exposed in a response.",
  },
};

export function classMeta(vc: VulnClass): VulnClassMeta {
  return VULN_CLASS_META[vc] ?? { label: vc, short: vc, blurb: "" };
}

/** Icon per class — 16px stroke set, matches the config icon language. */
export function ClassIcon({
  vc,
  className = "h-4 w-4",
}: {
  vc: VulnClass;
  className?: string;
}) {
  const base = {
    viewBox: "0 0 20 20",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };
  switch (vc) {
    case "rls":
      return (
        <svg {...base}>
          <ellipse cx="10" cy="4.5" rx="6" ry="2" />
          <path d="M4 4.5v11c0 1.1 2.7 2 6 2s6-.9 6-2v-11" />
          <path d="M4 10c0 1.1 2.7 2 6 2s6-.9 6-2" />
        </svg>
      );
    case "secret":
      return (
        <svg {...base}>
          <rect x="4.5" y="9" width="11" height="7" rx="1.5" />
          <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
        </svg>
      );
    case "bola":
      return (
        <svg {...base}>
          <circle cx="7" cy="7" r="2.5" />
          <path d="M3 15.5c.5-2.5 2.3-4 4-4s3.5 1.5 4 4" />
          <path d="M13.5 8.5 16 11l-2.5 2.5" />
        </svg>
      );
    case "auth":
      return (
        <svg {...base}>
          <path d="M10 2.5 4.5 4.5v5c0 3.4 2.4 6.3 5.5 7.5 3.1-1.2 5.5-4.1 5.5-7.5v-5L10 2.5Z" />
          <path d="M10 8v3M10 6.3v.2" />
        </svg>
      );
    case "injection":
      return (
        <svg {...base}>
          <path d="M7 5 3.5 8.5 7 12M13 5l3.5 3.5L13 12M11.5 4l-3 12" />
        </svg>
      );
    case "ssrf":
      return (
        <svg {...base}>
          <circle cx="10" cy="10" r="6.5" />
          <path d="M3.5 10h13M10 3.5c1.8 2 2.8 4.2 2.8 6.5s-1 4.5-2.8 6.5c-1.8-2-2.8-4.2-2.8-6.5s1-4.5 2.8-6.5Z" />
        </svg>
      );
    case "exposure":
      return (
        <svg {...base}>
          <path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z" />
          <circle cx="10" cy="10" r="2" />
        </svg>
      );
    default:
      return (
        <svg {...base}>
          <circle cx="10" cy="10" r="6.5" />
        </svg>
      );
  }
}
