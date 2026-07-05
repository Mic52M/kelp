// Injection probe backend wired against the deliberately-vulnerable test target
// (apps/test-target). Deterministic detection: submit a baseline benign value
// for the parameter, record the row count, then submit each payload from a
// small catalog and flag a bypass if any payload strictly widens the result.
// This is a mock-realistic version of what a live SQLi probe does — with real
// customer targets the same shape applies (compare response entropy / count /
// error signatures against baseline).

import type { InjectionBackend, InjectionFamily } from "@kelp/core";

export interface InjectionTargetConfig {
  baseUrl: string;
  accountA: { email: string; password: string };
}

interface Payload {
  value: string;
  family: InjectionFamily;
}

// A small, safe catalog — every payload is a well-known injection tell and
// none tries to actually damage data (no DROP TABLE etc.). Enough to
// distinguish bypass from safe on the test target.
const PAYLOADS: Payload[] = [
  { value: "' OR '1'='1", family: "sql_or_true" },
  { value: "' OR 1=1--", family: "sql_or_true" },
  { value: "' UNION SELECT null--", family: "sql_union" },
  { value: "x'--", family: "sql_terminator" },
];

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

async function countAt(endpoint: string, param: string, value: string, token: string): Promise<number | null> {
  const url = new URL(endpoint);
  url.searchParams.set(param, value);
  const res = await fetch(url.toString(), { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { count?: number } | null;
  return typeof body?.count === "number" ? body.count : null;
}

export async function createTestTargetInjectionBackend(
  cfg: InjectionTargetConfig,
): Promise<InjectionBackend> {
  const tokenA = await login(cfg.baseUrl, cfg.accountA.email, cfg.accountA.password);

  return {
    async listEndpoints() {
      return [
        { endpoint: `${cfg.baseUrl}/api/orders/search`, parameter: "q", description: "search by memo (SQL-like)" },
        { endpoint: `${cfg.baseUrl}/api/orders/find`, parameter: "q", description: "search by memo (parameterised)" },
      ];
    },

    async probe(_projectId: string, endpoint: string, parameter: string) {
      // Baseline: query with a benign value the caller could reasonably send.
      const baseline = await countAt(endpoint, parameter, "kelp-benign", tokenA);
      if (baseline === null) return { bypassed: false };
      // Try each payload; if any strictly widens the count, we've confirmed.
      for (const p of PAYLOADS) {
        const under = await countAt(endpoint, parameter, p.value, tokenA);
        if (under !== null && under > baseline) {
          return { bypassed: true, payloadFamily: p.family };
        }
      }
      return { bypassed: false };
    },
  };
}
