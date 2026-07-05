// Weak-crypto probe backend wired against the running test target. Reads the
// Set-Cookie header of each endpoint and hands off to auditSetCookie in
// @kelp/core, which returns which required flags are present/missing on the
// session-identifier cookie. Never reads or persists the cookie value — Kelp's
// data-hygiene rule applies here too.

import { auditSetCookie, type WeakCryptoBackend } from "@kelp/core";

export interface WeakCryptoTargetConfig {
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

export async function createTestTargetWeakCryptoBackend(
  cfg: WeakCryptoTargetConfig,
): Promise<WeakCryptoBackend> {
  const tokenA = await login(cfg.baseUrl, cfg.accountA.email, cfg.accountA.password);

  return {
    async listEndpointsSettingCookies() {
      return [
        { endpoint: `${cfg.baseUrl}/api/set-insecure-cookie`, description: "vulnerable cookie setter" },
        { endpoint: `${cfg.baseUrl}/api/set-secure-cookie`, description: "control (all flags present)" },
      ];
    },

    async probeCookieFlags(_projectId: string, endpoint: string) {
      try {
        const res = await fetch(endpoint, {
          headers: { authorization: `Bearer ${tokenA}` },
          signal: AbortSignal.timeout(2000),
        });
        const raw = res.headers.get("set-cookie");
        if (!raw) return { cookieName: null, present: [], missing: [] };
        // auditSetCookie owns the flag decision — the backend never decides
        // which flags matter (Kelp's dictionary lives there).
        return auditSetCookie(raw);
      } catch {
        return { cookieName: null, present: [], missing: [] };
      }
    },
  };
}
