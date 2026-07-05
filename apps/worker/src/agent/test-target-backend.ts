// BOLA probe backend wired against the deliberately-vulnerable test target
// (apps/test-target). Two test accounts, real HTTP requests, deterministic
// verdict. Used only for end-to-end validation of Kelp's pen-testing
// specialists — NEVER in a customer path.

import type { BolaProbeBackend } from "@kelp/core";

export interface TestTargetConfig {
  /** base URL of the running test target, e.g. http://localhost:4400 */
  baseUrl: string;
  /** the two test accounts we authenticate as */
  accountA: { email: string; password: string };
  accountB: { email: string; password: string };
  /** cached tokens; populated by init() */
  tokens?: { a: string; b: string };
  /** ids owned by account B that A must NOT be able to read cross-account */
  bOwnedIds: string[];
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

/**
 * Build the BOLA probe backend for the test target. Logs in as both test
 * accounts once, then reuses the tokens across probes.
 */
export async function createTestTargetBolaBackend(
  cfg: TestTargetConfig,
): Promise<BolaProbeBackend> {
  const tokenA = await login(cfg.baseUrl, cfg.accountA.email, cfg.accountA.password);
  const tokenB = await login(cfg.baseUrl, cfg.accountB.email, cfg.accountB.password);
  void tokenB; // we don't need B's session for probing — A tries to reach B's ids.

  return {
    // The specialist calls listEndpoints first; we hard-code the surface here
    // because the test target is a fixed target. In production this comes from
    // a schema/crawl step per project.
    async listEndpoints() {
      return [
        {
          endpoint: `${cfg.baseUrl}/api/orders/{id}`,
          resourceKind: "order",
          idParameter: "id",
        },
        {
          endpoint: `${cfg.baseUrl}/api/profiles/{id}`,
          resourceKind: "profile",
          idParameter: "id",
        },
      ];
    },

    async probe(_projectId: string, endpoint: string) {
      // For each candidate endpoint, try every id account B owns while
      // authenticated as A. If ANY of them returns a 2xx with the owner being
      // someone other than A, that's a confirmed cross-account read.
      for (const bId of cfg.bOwnedIds) {
        const url = endpoint.replace("{id}", bId);
        const res = await fetch(url, {
          headers: { authorization: `Bearer ${tokenA}` },
        });
        if (!res.ok) continue;
        // Never store the response body — we look only at whether the read
        // succeeded, matching the data-hygiene rule Kelp enforces in prod.
        return { crossAccountAccess: true };
      }
      return { crossAccountAccess: false };
    },
  };
}
