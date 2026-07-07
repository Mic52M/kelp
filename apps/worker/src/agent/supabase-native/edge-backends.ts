// Stage B backends: the four HTTP specialists (auth-bypass, injection, SSRF,
// weak-crypto) wired against a customer's Supabase Edge Functions.
//
// Discovery (packages/core/edge-functions.ts) already parsed the repo into
// DiscoveredEdgeFunction[] with a read-only/mutating classification. SAFETY:
// every backend here filters to `!fn.mutating` — Kelp never invokes a
// destructive function (delete-account, create-payment-checkout, …). That
// guarantee lives here, at the one place that turns a function into an HTTP
// call.
//
// Applicability to the Supabase-edge stack (honest):
//   · auth-bypass — HIGH value. Detects a function that trusts a client-
//                   supplied identity (userId/email in body/query) instead of
//                   the verified JWT. The #1 hand-written-backend bug.
//   · injection   — possible; most edge functions use parameterized Supabase
//                   queries (safe) so this usually — correctly — finds nothing.
//   · ssrf        — needs a URL param AND a publicly-reachable callback host.
//                   The worker's localhost listener isn't reachable from
//                   Supabase's cloud, so today this probes but won't confirm
//                   from prod. Left wired for the day we host a public canary.
//   · weak-crypto — edge functions return JSON, not Set-Cookie, so this is
//                   effectively N/A here and reports nothing.

import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type {
  AuthBypassBackend,
  ImpersonationTechnique,
  InjectionBackend,
  InjectionFamily,
  SsrfBackend,
  SsrfTechnique,
  WeakCryptoBackend,
  RequiredCookieFlag,
  DiscoveredEdgeFunction,
} from "@kelp/core";
import { edgeFunctionUrl } from "@kelp/core";
import type { SupabaseSession } from "./auth.js";

const REQUEST_TIMEOUT_MS = 8000;

export interface EdgeBackendConfig {
  ref: string;
  anonKey: string;
  sessionA: SupabaseSession;
  sessionB: SupabaseSession;
  /** Full discovery output; each backend filters to the safe subset it needs. */
  functions: DiscoveredEdgeFunction[];
  /** Override the `https://<ref>.supabase.co/functions/v1` base — used by the
   *  verify harness to point at a local mock, and by self-hosted Supabase. */
  baseUrlOverride?: string;
}

function fnUrl(cfg: EdgeBackendConfig, name: string): string {
  return cfg.baseUrlOverride
    ? `${cfg.baseUrlOverride.replace(/\/$/, "")}/${name}`
    : edgeFunctionUrl(cfg.ref, name);
}

/** One edge-function invocation. Returns only status + a hash/length of the
 *  body — never the body itself (pen-test data-hygiene rule). */
interface EdgeCallResult {
  status: number;
  bodyHash: string;
  bodyLen: number;
}

async function callEdgeFunction(
  cfg: EdgeBackendConfig,
  name: string,
  opts: {
    token: string;
    body?: Record<string, unknown>;
    query?: Record<string, string>;
    extraHeaders?: Record<string, string>;
  },
): Promise<EdgeCallResult> {
  let url = fnUrl(cfg, name);
  if (opts.query && Object.keys(opts.query).length > 0) {
    url += `?${new URLSearchParams(opts.query).toString()}`;
  }
  const headers: Record<string, string> = {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${opts.token}`,
    "content-type": "application/json",
    ...opts.extraHeaders,
  };
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(opts.body ?? {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { status: 0, bodyHash: "", bodyLen: 0 };
  }
  const raw = await res.text().catch(() => "");
  return { status: res.status, bodyHash: createHash("sha256").update(raw).digest("hex"), bodyLen: raw.length };
}

/** Plausible filler for a param whose value we don't know — enough to get a
 *  function past a "missing field" guard without meaning anything. */
function filler(param: string): string {
  const p = param.toLowerCase();
  if (/sport/.test(p)) return "running";
  if (/email/.test(p)) return "kelp-probe@kelp-test.local";
  if (/lang|locale/.test(p)) return "en";
  if (/prompt|text|message|request|note|comment|query/.test(p)) return "kelp baseline probe";
  return "kelp-probe";
}

function safe(functions: DiscoveredEdgeFunction[]): DiscoveredEdgeFunction[] {
  return functions.filter((f) => !f.mutating);
}

function byName(functions: DiscoveredEdgeFunction[]): Map<string, DiscoveredEdgeFunction> {
  return new Map(functions.map((f) => [f.name, f]));
}

// ─── auth-bypass ─────────────────────────────────────────────────────────────

export function createEdgeAuthBypassBackend(cfg: EdgeBackendConfig): AuthBypassBackend {
  const fns = byName(cfg.functions);
  // Only safe functions that take a client-supplied identity param can be
  // impersonation-tested — otherwise there's nothing to override.
  const targets = safe(cfg.functions).filter((f) => f.identityParams.length > 0);

  function bodyWith(fn: DiscoveredEdgeFunction, identityValue: string): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    for (const p of fn.bodyParams) {
      body[p] = fn.identityParams.includes(p) ? identityValue : filler(p);
    }
    return body;
  }
  function queryWith(fn: DiscoveredEdgeFunction, identityValue: string): Record<string, string> {
    const q: Record<string, string> = {};
    for (const p of fn.queryParams) q[p] = fn.identityParams.includes(p) ? identityValue : filler(p);
    return q;
  }

  return {
    async listEndpoints() {
      return targets.map((f) => ({
        endpoint: f.name,
        description: `edge function; identity param(s): ${f.identityParams.join(", ")}`,
      }));
    },
    async probe(_projectId, endpoint, technique: ImpersonationTechnique) {
      const fn = fns.get(endpoint);
      if (!fn || fn.mutating || fn.identityParams.length === 0) return { bypassed: false };

      // Baseline: A asks for its OWN data. Attack: A asks (as itself) for B's
      // data by putting B's identity where the function reads identity.
      const idInBody = fn.identityParams.some((p) => fn.bodyParams.includes(p));
      const idInQuery = fn.identityParams.some((p) => fn.queryParams.includes(p));

      if (technique === "userid_body_override" && idInBody) {
        const base = await callEdgeFunction(cfg, endpoint, {
          token: cfg.sessionA.accessToken,
          body: bodyWith(fn, cfg.sessionA.userId),
        });
        const attack = await callEdgeFunction(cfg, endpoint, {
          token: cfg.sessionA.accessToken,
          body: bodyWith(fn, cfg.sessionB.userId),
        });
        // Both succeed AND the response changed with the client-supplied id ⇒
        // the function honored the body identity instead of the JWT.
        const bypassed =
          base.status > 0 && base.status < 300 && attack.status < 300 && attack.bodyHash !== base.bodyHash;
        return { bypassed };
      }

      if (technique === "query_as_param" && idInQuery) {
        const base = await callEdgeFunction(cfg, endpoint, {
          token: cfg.sessionA.accessToken,
          query: queryWith(fn, cfg.sessionA.userId),
        });
        const attack = await callEdgeFunction(cfg, endpoint, {
          token: cfg.sessionA.accessToken,
          query: queryWith(fn, cfg.sessionB.userId),
        });
        const bypassed =
          base.status > 0 && base.status < 300 && attack.status < 300 && attack.bodyHash !== base.bodyHash;
        return { bypassed };
      }

      // x_user_header / token_swap aren't meaningful for Supabase edge funcs
      // (identity comes from the JWT, which we don't forge).
      return { bypassed: false };
    },
  };
}

// ─── injection ───────────────────────────────────────────────────────────────

const INJECTION_PAYLOADS: { value: string; family: InjectionFamily }[] = [
  { value: "kelp' OR '1'='1", family: "sql_or_true" },
  { value: "kelp' UNION SELECT NULL--", family: "sql_union" },
  { value: "kelp'; --", family: "sql_terminator" },
  { value: '{"$gt":""}', family: "nosql" },
];

export function createEdgeInjectionBackend(cfg: EdgeBackendConfig): InjectionBackend {
  const fns = byName(cfg.functions);
  // Safe functions with at least one non-identity text body param.
  const targets = safe(cfg.functions).filter(
    (f) => f.bodyParams.some((p) => !f.identityParams.includes(p)),
  );

  return {
    async listEndpoints() {
      const out: { endpoint: string; parameter: string; description?: string }[] = [];
      for (const f of targets) {
        for (const p of f.bodyParams) {
          if (f.identityParams.includes(p)) continue;
          out.push({ endpoint: f.name, parameter: p, description: "edge function body param" });
        }
      }
      return out;
    },
    async probe(_projectId, endpoint, parameter) {
      const fn = fns.get(endpoint);
      if (!fn || fn.mutating) return { bypassed: false };
      const mkBody = (val: string): Record<string, unknown> => {
        const b: Record<string, unknown> = {};
        for (const p of fn.bodyParams) b[p] = p === parameter ? val : filler(p);
        return b;
      };
      const baseline = await callEdgeFunction(cfg, endpoint, {
        token: cfg.sessionA.accessToken,
        body: mkBody("kelp_baseline_value"),
      });
      if (baseline.status === 0) return { bypassed: false };
      for (const pl of INJECTION_PAYLOADS) {
        const r = await callEdgeFunction(cfg, endpoint, {
          token: cfg.sessionA.accessToken,
          body: mkBody(pl.value),
        });
        // High-signal, low-FP: a payload that flips a healthy baseline into a
        // 5xx (query broke) or flips a rejected baseline into success (filter
        // bypassed) is evidence the input reaches an interpreter unsanitized.
        const brokeIt = baseline.status < 400 && r.status >= 500;
        const bypassedFilter = baseline.status >= 400 && r.status > 0 && r.status < 300;
        if (brokeIt || bypassedFilter) return { bypassed: true, payloadFamily: pl.family };
      }
      return { bypassed: false };
    },
  };
}

// ─── SSRF ────────────────────────────────────────────────────────────────────

interface Listener { port: number; server: http.Server; hits: Set<string>; }
function startListener(): Promise<Listener> {
  return new Promise((resolve) => {
    const hits = new Set<string>();
    const server = http.createServer((req, res) => {
      const m = /^\/probe\/([a-f0-9-]+)/.exec(req.url ?? "");
      if (m) hits.add(m[1]!);
      res.statusCode = 204;
      res.end();
    });
    server.listen(0, "127.0.0.1", () => resolve({ port: (server.address() as AddressInfo).port, server, hits }));
  });
}
function callbackFor(technique: SsrfTechnique, port: number, token: string): string {
  const path = `/probe/${token}`;
  switch (technique) {
    case "plain_http": return `http://127.0.0.1:${port}${path}`;
    case "loopback_127": return `http://127.0.0.1:${port}${path}`;
    case "loopback_localhost": return `http://localhost:${port}${path}`;
    case "url_encoded_host": return `http://%31%32%37%2E%30%2E%30%2E%31:${port}${path}`;
    case "metadata_ip": return `http://169.254.169.254${path}`;
  }
}

export function createEdgeSsrfBackend(cfg: EdgeBackendConfig): SsrfBackend {
  const fns = byName(cfg.functions);
  const targets = safe(cfg.functions).filter((f) => f.urlParams.length > 0);
  return {
    async listEndpoints() {
      const out: { endpoint: string; parameter: string; description?: string }[] = [];
      for (const f of targets) for (const p of f.urlParams) {
        out.push({ endpoint: f.name, parameter: p, description: "edge function URL param" });
      }
      return out;
    },
    async probe(_projectId, endpoint, parameter, technique) {
      const fn = fns.get(endpoint);
      if (!fn || fn.mutating) return { bypassed: false };
      const listener = await startListener();
      try {
        const token = randomUUID();
        const body: Record<string, unknown> = {};
        for (const p of fn.bodyParams) body[p] = p === parameter ? callbackFor(technique, listener.port, token) : filler(p);
        await callEdgeFunction(cfg, endpoint, { token: cfg.sessionA.accessToken, body });
        await new Promise((r) => setTimeout(r, 1500));
        return { bypassed: listener.hits.has(token) };
      } finally {
        listener.server.close();
      }
    },
  };
}

// ─── weak-crypto ─────────────────────────────────────────────────────────────

const REQUIRED_FLAGS: RequiredCookieFlag[] = ["HttpOnly", "Secure", "SameSite"];

export function createEdgeWeakCryptoBackend(cfg: EdgeBackendConfig): WeakCryptoBackend {
  const targets = safe(cfg.functions);
  // We must actually observe a Set-Cookie to have anything to audit. Probe each
  // safe function once; keep only those that set a cookie. (Edge functions
  // almost never do — this list is usually empty, which is the honest answer.)
  async function cookieHeaderFor(name: string): Promise<string | null> {
    try {
      const res = await fetch(fnUrl(cfg, name), {
        method: "POST",
        headers: { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.sessionA.accessToken}`, "content-type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return res.headers.get("set-cookie");
    } catch {
      return null;
    }
  }
  return {
    async listEndpointsSettingCookies() {
      const out: { endpoint: string; description?: string }[] = [];
      for (const f of targets) {
        if (await cookieHeaderFor(f.name)) out.push({ endpoint: f.name, description: "edge function sets a cookie" });
      }
      return out;
    },
    async probeCookieFlags(_projectId, endpoint) {
      const header = await cookieHeaderFor(endpoint);
      if (!header) return { cookieName: null, present: [], missing: [] };
      const cookieName = header.split("=")[0]?.trim() ?? null;
      const present = REQUIRED_FLAGS.filter((f) => new RegExp(f, "i").test(header));
      const missing = REQUIRED_FLAGS.filter((f) => !present.includes(f));
      return { cookieName, present, missing };
    },
  };
}
