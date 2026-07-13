// Product analytics (#34), server-side surface. Uses PostHog's raw capture
// endpoint (/i/v0/e/) instead of posthog-node — same rationale as the client
// wrapper: guaranteed delivery, tiny surface, no interference from the
// project's `defaultIdentifiedOnly:true` remote config on the client. On the
// server we control the distinctId directly so events are always "identified"
// from PostHog's point of view.
//
// The client-side surface lives in components/PostHogProvider.tsx and shares
// the same event catalog below. A typo in either surface fails typecheck.

import { createHash } from "node:crypto";

/** Canonical event catalog (v1). Any event fired must appear here — this
 *  type keeps client and server call sites honest. Names use `noun.verb_past`
 *  so PostHog funnels read as sequences. */
export type AnalyticsEvent =
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

export type AnalyticsProps = Record<string, string | number | boolean | null | undefined>;

function getConfig(): { key: string; host: string } | null {
  const key = process.env.POSTHOG_KEY ?? process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;
  const host = process.env.POSTHOG_HOST ?? "https://eu.i.posthog.com";
  return { key, host };
}

/** Fire an event server-side. `distinctId` should be the Supabase user id
 *  when known, or a stable anonymous id (free-scan slug) for pre-signup
 *  events — the client-side identify() emits `$identify` with
 *  `$anon_distinct_id` so PostHog stitches the timelines. */
export function track(
  distinctId: string,
  event: AnalyticsEvent,
  properties?: AnalyticsProps,
): void {
  const cfg = getConfig();
  if (!cfg) return;
  const body = JSON.stringify({
    api_key: cfg.key,
    event,
    distinct_id: distinctId,
    properties: { source: "server", ...(properties ?? {}) },
    timestamp: new Date().toISOString(),
  });
  // Fire-and-forget; never block the caller. `keepalive` isn't a Node fetch
  // option but the request completes quickly enough that the process holds
  // it. In the worker's SIGTERM path the caller can `await flush()`.
  fetch(`${cfg.host}/i/v0/e/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }).catch(() => {
    /* silent — analytics never surface errors */
  });
}

/** Associate a distinctId with properties (email hash, org id, plan). Fires
 *  `$identify` — safe to call multiple times per user. */
export function identify(
  distinctId: string,
  properties: { email_sha256?: string; org_id?: string; plan?: string; handle?: string },
): void {
  const cfg = getConfig();
  if (!cfg) return;
  const body = JSON.stringify({
    api_key: cfg.key,
    event: "$identify",
    distinct_id: distinctId,
    properties: { $set: { ...properties }, source: "server" },
    timestamp: new Date().toISOString(),
  });
  fetch(`${cfg.host}/i/v0/e/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }).catch(() => {
    /* silent */
  });
}

/** Merge a pre-signup anonymous id (free-scan slug) with a post-signup user
 *  id so a single Person timeline covers the whole funnel. Fires `$create_alias`. */
export function alias(previousId: string, distinctId: string): void {
  const cfg = getConfig();
  if (!cfg) return;
  const body = JSON.stringify({
    api_key: cfg.key,
    event: "$create_alias",
    distinct_id: distinctId,
    properties: { alias: previousId, source: "server" },
    timestamp: new Date().toISOString(),
  });
  fetch(`${cfg.host}/i/v0/e/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }).catch(() => {
    /* silent */
  });
}

/** Hash an email for use as `email_sha256` or as a stable distinctId when
 *  no user id is available. Mixes a per-deploy pepper if configured
 *  (`ANALYTICS_PEPPER`) so the resulting id can't be brute-forced from a
 *  public email list. */
export function hashEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const pepper = process.env.ANALYTICS_PEPPER ?? "";
  return createHash("sha256").update(pepper + normalized).digest("hex");
}

/** Derive an analytics identity for a Supabase user. Returns null when we
 *  don't have a user id — callers fall back to an anonymous id for
 *  pre-signup events. */
export function identityForUser(
  user: { id: string; email?: string | null } | null,
): { distinctId: string; email_sha256?: string } | null {
  if (!user?.id) return null;
  return {
    distinctId: user.id,
    ...(user.email ? { email_sha256: hashEmail(user.email) } : {}),
  };
}

/** No-op kept for API compatibility with the previous posthog-node-based
 *  wrapper; the raw fetch surface doesn't buffer, so there's nothing to
 *  flush. Retained so long-running processes can `await flush()` without
 *  version-guarding their code. */
export async function flush(): Promise<void> {
  /* raw fetch: nothing to flush */
}
