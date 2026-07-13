// Worker-side product analytics (#34). Mirrors apps/web/lib/analytics.ts —
// raw fetch to PostHog's /i/v0/e/ endpoint. Same no-op-if-unconfigured
// contract. Rationale for raw over posthog-node: full delivery guarantee,
// no interference from project-level `defaultIdentifiedOnly` semantics, and
// a zero-transitive-deps wrapper we can drop into any Node/edge runtime.

export type WorkerEvent = "scan.completed" | "scan.failed" | "plan.upgrade_completed";

export type WorkerProps = Record<string, string | number | boolean | null | undefined>;

function getConfig(): { key: string; host: string } | null {
  const key = process.env.POSTHOG_KEY ?? process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;
  const host = process.env.POSTHOG_HOST ?? "https://eu.i.posthog.com";
  return { key, host };
}

/** Fire a scan-lifecycle or billing event. `distinctId` is the org id —
 *  scans are produced by orgs, not by a single acting user (a webhook-
 *  triggered scan has no acting user at all), so per-org attribution keeps
 *  funnels honest. */
export function trackWorker(
  distinctId: string,
  event: WorkerEvent,
  properties?: WorkerProps,
): void {
  const cfg = getConfig();
  if (!cfg) return;
  const body = JSON.stringify({
    api_key: cfg.key,
    event,
    distinct_id: distinctId,
    properties: { source: "worker", ...(properties ?? {}) },
    timestamp: new Date().toISOString(),
  });
  fetch(`${cfg.host}/i/v0/e/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }).catch(() => {
    /* silent — analytics never surface errors */
  });
}

/** No-op — the raw wrapper doesn't buffer, so there's nothing to flush.
 *  Kept for API compatibility with future batched implementations. */
export async function flushWorker(): Promise<void> {
  /* raw fetch: nothing to flush */
}
