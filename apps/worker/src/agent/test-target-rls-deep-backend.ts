// RLS-deep probe backend wired against the running test target's mock DB
// (apps/test-target /api/db/*). Logs in as account A, then for each table
// asks the mock DB for rows owned by account B via account A's session. A
// non-empty response is the confirmed cross-account read.

import type { RlsDeepBackend } from "@kelp/core";

export interface RlsDeepTargetConfig {
  baseUrl: string;
  accountA: { email: string; password: string };
  /** the user id whose rows account A tries to reach */
  targetOwnerId: string;
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

export async function createTestTargetRlsDeepBackend(
  cfg: RlsDeepTargetConfig,
): Promise<RlsDeepBackend> {
  const tokenA = await login(cfg.baseUrl, cfg.accountA.email, cfg.accountA.password);

  return {
    async listTables() {
      const res = await fetch(`${cfg.baseUrl}/api/db/tables`, {
        headers: { authorization: `Bearer ${tokenA}` },
      });
      if (!res.ok) return [];
      const body = (await res.json()) as { tables: { name: string }[] };
      return body.tables.map((t) => ({ table: t.name }));
    },

    async probeCrossAccountRead(_projectId: string, table: string) {
      const url = new URL(`${cfg.baseUrl}/api/db/select`);
      url.searchParams.set("table", table);
      url.searchParams.set("owner", cfg.targetOwnerId);
      const res = await fetch(url.toString(), {
        headers: { authorization: `Bearer ${tokenA}` },
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) return { crossAccountAccess: false };
      // Deliberately inspect only the row count — never the rows themselves.
      const body = (await res.json().catch(() => null)) as { rowCount?: number } | null;
      return { crossAccountAccess: (body?.rowCount ?? 0) > 0 };
    },
  };
}
