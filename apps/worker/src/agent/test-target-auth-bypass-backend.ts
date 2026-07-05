// Auth-bypass probe backend wired against the deliberately-vulnerable test
// target (apps/test-target). Real HTTP requests; verdict is deterministic and
// evidence-based: we call the endpoint under each impersonation technique with
// account A's session and check whether the response reports the impersonated
// user as the "effective" identity (or returns data owned by them).

import type { AuthBypassBackend, ImpersonationTechnique } from "@kelp/core";

export interface AuthBypassTargetConfig {
  baseUrl: string;
  accountA: { email: string; password: string };
  /** the identity we try to impersonate — its userId + a resource id it owns */
  targetUserId: string;
  targetOwnedIds: string[];
}

async function login(baseUrl: string, email: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed for ${email}: ${res.status}`);
  const body = (await res.json()) as { token: string };
  return body.token;
}

export async function createTestTargetAuthBypassBackend(
  cfg: AuthBypassTargetConfig,
): Promise<AuthBypassBackend> {
  const tokenA = await login(cfg.baseUrl, cfg.accountA.email, cfg.accountA.password);

  return {
    async listEndpoints() {
      return [
        { endpoint: `${cfg.baseUrl}/api/session-lookup`, description: "session identity echo" },
        { endpoint: `${cfg.baseUrl}/api/me`, description: "auth surface" },
      ];
    },

    async probe(_projectId: string, endpoint: string, technique: ImpersonationTechnique) {
      // Apply each known impersonation technique against `endpoint`. We only
      // implement the ones our test target actually supports; unknown
      // combinations return bypassed=false (no false positive).
      try {
        switch (technique) {
          case "query_as_param": {
            const url = new URL(endpoint);
            url.searchParams.set("as", cfg.targetUserId);
            const res = await fetch(url.toString(), {
              headers: { authorization: `Bearer ${tokenA}` },
            });
            if (!res.ok) return { bypassed: false };
            // Never keep the body — inspect just enough to confirm identity swap.
            const body = (await res.json().catch(() => null)) as
              | { effectiveUserId?: string; orders?: Array<{ id: string }> }
              | null;
            const identitySwapped = body?.effectiveUserId === cfg.targetUserId;
            const leakedOwnedResource =
              body?.orders?.some((o) => cfg.targetOwnedIds.includes(o.id)) ?? false;
            return { bypassed: identitySwapped || leakedOwnedResource };
          }
          case "x_user_header": {
            const res = await fetch(endpoint, {
              headers: {
                authorization: `Bearer ${tokenA}`,
                "x-user": cfg.targetUserId,
              },
            });
            if (!res.ok) return { bypassed: false };
            const body = (await res.json().catch(() => null)) as { userId?: string; effectiveUserId?: string } | null;
            const impersonated =
              body?.userId === cfg.targetUserId || body?.effectiveUserId === cfg.targetUserId;
            return { bypassed: impersonated };
          }
          case "userid_body_override":
          case "token_swap":
            // Not implemented against the target — leaves them as "denied".
            return { bypassed: false };
        }
      } catch {
        return { bypassed: false };
      }
    },
  };
}
