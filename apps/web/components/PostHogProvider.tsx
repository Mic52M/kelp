"use client";

// Client-side analytics provider (#34). Uses PostHog's raw capture endpoint
// (/i/v0/e/) instead of posthog-js. Rationale: posthog-js in recent versions
// (v1.399+) is a strict ES module that never attaches to `window`, and the EU
// project's remote config (`defaultIdentifiedOnly:true`) silently drops
// anonymous events even when the client-side `person_profiles:'always'`
// override is set. Raw fetch gives us guaranteed delivery, tiny surface, and
// zero surprises. We give up autocapture / session recording / feature flags
// — none of which are used in Kelp's event catalog.

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type ClientEvent =
  | "free_scan.submitted"
  | "free_scan.completed"
  | "free_scan.email_captured"
  | "free_scan.signed_up_after_free"
  | "free_scan.shared"
  | "free_scan.viewed_from_share"
  | "signup.completed"
  | "github_installed"
  | "supabase_connected"
  | "project.created"
  | "scan.started"
  | "scan.completed"
  | "scan.failed"
  | "finding.viewed"
  | "finding.dismissed"
  | "finding.marked_false_positive"
  | "finding.marked_resolved"
  | "finding.fix_prompt_copied"
  | "finding.pr_opened"
  | "plan.upgrade_started"
  | "plan.upgrade_completed";

type ClientProps = Record<string, string | number | boolean | null | undefined>;

const DISTINCT_ID_KEY = "kelp_ph_distinct_id";
const IDENTITY_KEY = "kelp_ph_identity_v1";

interface Identity {
  distinctId: string;
  emailSha256?: string;
}

/** Guarantees a stable per-browser distinctId. Signed-in visitors are
 *  keyed on their Supabase user id (set later via setIdentity); anonymous
 *  visitors get a UUID that persists in localStorage so the funnel merges
 *  across pages within a session. */
function ensureDistinctId(): string {
  if (typeof window === "undefined") return "server";
  const stored = window.localStorage.getItem(DISTINCT_ID_KEY);
  if (stored) return stored;
  const id = window.crypto?.randomUUID?.() ?? `anon_${Math.random().toString(36).slice(2)}${Date.now()}`;
  window.localStorage.setItem(DISTINCT_ID_KEY, id);
  return id;
}

function getIdentity(): Identity | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(IDENTITY_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Identity;
  } catch {
    return null;
  }
}

function setIdentity(id: Identity): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(id));
  window.localStorage.setItem(DISTINCT_ID_KEY, id.distinctId);
}

function getConfig(): { key: string; host: string } | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";
  return { key, host };
}

/** POST an event to PostHog's raw ingestion endpoint. Uses `keepalive` so a
 *  navigation-triggered event doesn't get cancelled by the router. Silent on
 *  failure — analytics must never block a user action. */
function send(event: string, distinctId: string, properties: ClientProps): void {
  const cfg = getConfig();
  if (!cfg) return;
  // Respect Do Not Track at the source.
  if (typeof navigator !== "undefined" && navigator.doNotTrack === "1") return;

  const body = JSON.stringify({
    api_key: cfg.key,
    event,
    distinct_id: distinctId,
    properties: {
      $lib: "kelp-web-raw",
      $current_url: typeof window !== "undefined" ? window.location.href : undefined,
      $host: typeof window !== "undefined" ? window.location.host : undefined,
      $pathname: typeof window !== "undefined" ? window.location.pathname : undefined,
      source: "browser",
      ...properties,
    },
    timestamp: new Date().toISOString(),
  });

  try {
    void fetch(`${cfg.host}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      /* ignore — analytics never surface errors */
    });
  } catch {
    /* older browsers without keepalive → no-op */
  }
}

/** Fire a named event from the browser. */
export function track(event: ClientEvent, properties?: ClientProps): void {
  const distinctId = ensureDistinctId();
  send(event, distinctId, properties ?? {});
}

/** Associate the signed-in identity with this browser session. Emits an
 *  `$identify` event so PostHog links the current anonymous distinctId with
 *  the user id going forward. */
export function identifyClient(
  distinctId: string,
  properties: { email_sha256?: string; org_id?: string; plan?: string },
): void {
  const cfg = getConfig();
  if (!cfg) return;
  if (typeof navigator !== "undefined" && navigator.doNotTrack === "1") return;

  const previous = ensureDistinctId();
  setIdentity({ distinctId, emailSha256: properties.email_sha256 });

  // $identify with $anon_distinct_id merges the pre-signup timeline into
  // the signed-in Person. Skips the merge when previous == new (already
  // identified from a prior session).
  const body = JSON.stringify({
    api_key: cfg.key,
    event: "$identify",
    distinct_id: distinctId,
    properties: {
      $set: {
        ...(properties.email_sha256 ? { email_sha256: properties.email_sha256 } : {}),
        ...(properties.org_id ? { org_id: properties.org_id } : {}),
        ...(properties.plan ? { plan: properties.plan } : {}),
      },
      ...(previous && previous !== distinctId ? { $anon_distinct_id: previous } : {}),
    },
    timestamp: new Date().toISOString(),
  });

  try {
    void fetch(`${cfg.host}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      /* silent */
    });
  } catch {
    /* silent */
  }
}

/** Provider. Mount once from the root layout; identifies the signed-in
 *  user (if any) and fires $pageview on every App-Router route change. */
export function PostHogProvider({
  userId,
  emailHash,
}: {
  userId: string | null;
  emailHash: string | null;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const identifiedFor = useRef<string | null>(null);

  // Seed the distinctId on first mount so every subsequent capture uses a
  // stable value from localStorage.
  useEffect(() => {
    ensureDistinctId();
  }, []);

  useEffect(() => {
    if (!userId) return;
    if (identifiedFor.current === userId) return;
    identifyClient(userId, emailHash ? { email_sha256: emailHash } : {});
    identifiedFor.current = userId;
  }, [userId, emailHash]);

  useEffect(() => {
    if (!pathname) return;
    const url = pathname + (searchParams?.toString() ? `?${searchParams.toString()}` : "");
    const identity = getIdentity();
    const distinctId = identity?.distinctId ?? ensureDistinctId();
    send("$pageview", distinctId, { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}
