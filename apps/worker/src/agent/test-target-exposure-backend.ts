// Exposure probe backend wired against the running test target.
//
// **Data-hygiene guarantee**: this backend inspects the target's response
// JUST enough to extract the top-level field names of the response body and
// (if the body is an array) of the first element. Values are NEVER inspected,
// logged, or persisted. Everything after the field-name extraction happens on
// the name strings alone.

import type { ExposureBackend } from "@kelp/core";

export interface ExposureTargetConfig {
  baseUrl: string;
  accountA: { email: string; password: string };
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
 * Extract the top-level field names of a JSON response, plus (one level deep)
 * the field names of the first array element. That's enough to catch the
 * common shapes: `{ id, password_hash, … }` and `[ { id, password_hash, … } ]`.
 * We deliberately do not recurse further — deeper nesting is caller-specific
 * and false positives here erode trust.
 */
function extractFieldNames(body: unknown): string[] {
  const names = new Set<string>();
  const visit = (v: unknown) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) {
      if (v.length > 0) visit(v[0]);
      return;
    }
    if (typeof v === "object") {
      for (const k of Object.keys(v as Record<string, unknown>)) names.add(k);
    }
  };
  visit(body);
  return [...names];
}

export async function createTestTargetExposureBackend(
  cfg: ExposureTargetConfig,
): Promise<ExposureBackend> {
  const tokenA = await login(cfg.baseUrl, cfg.accountA.email, cfg.accountA.password);

  return {
    async listEndpoints() {
      return [
        { endpoint: `${cfg.baseUrl}/api/admin/users-with-hashes`, description: "admin user list" },
        { endpoint: `${cfg.baseUrl}/api/public-users`, description: "public user list" },
      ];
    },

    async probeResponseShape(_projectId: string, endpoint: string) {
      try {
        const res = await fetch(endpoint, {
          headers: { authorization: `Bearer ${tokenA}` },
          signal: AbortSignal.timeout(2000),
        });
        if (!res.ok) return { fieldNames: [] };
        const body = (await res.json().catch(() => null)) as unknown;
        // The moment field names are extracted we STOP touching the body —
        // never keep a reference, never log it. The rest of the specialist
        // operates on the string list only.
        return { fieldNames: extractFieldNames(body) };
      } catch {
        return { fieldNames: [] };
      }
    },
  };
}
