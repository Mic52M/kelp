// SSRF probe backend wired against the deliberately-vulnerable test target
// (apps/test-target). Uses the classic out-of-band evidence pattern:
//
//   1. Spin up a tiny HTTP listener on a random localhost port.
//   2. Ask the target endpoint to fetch a callback URL that points at that
//      listener with a random one-time token in the path.
//   3. If the listener records a request with the matching token within a
//      short window, the target's server actually made the fetch — that's
//      the unforgeable evidence.
//
// The listener never inspects headers or bodies beyond the token — the
// point is only to prove a request happened.

import http from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { SsrfBackend, SsrfTechnique } from "@kelp/core";

export interface SsrfTargetConfig {
  baseUrl: string;
  accountA: { email: string; password: string };
  /** how long to wait for a callback hit before giving up (ms) */
  probeTimeoutMs?: number;
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

interface Listener {
  port: number;
  server: http.Server;
  hits: Set<string>;
}

function startListener(): Promise<Listener> {
  return new Promise((resolve) => {
    const hits = new Set<string>();
    const server = http.createServer((req, res) => {
      // Path is /probe/<token>
      const match = /^\/probe\/([a-f0-9-]+)/.exec(req.url ?? "");
      if (match) hits.add(match[1]!);
      res.statusCode = 204;
      res.end();
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ port, server, hits });
    });
  });
}

/**
 * Build the probe URL variant for each technique. The listener always answers
 * on 127.0.0.1:<port>; the technique varies how we encode that host so a
 * naive filter (block "localhost", block "127.0.0.1", block by string match)
 * still gets caught. metadata_ip points at the cloud metadata address —
 * a naive endpoint that fetches it in dev is still SSRF-vulnerable in prod.
 */
function probeUrl(technique: SsrfTechnique, port: number, token: string): string {
  const path = `/probe/${token}`;
  switch (technique) {
    case "plain_http":
      return `http://127.0.0.1:${port}${path}`;
    case "loopback_127":
      return `http://127.0.0.1:${port}${path}`;
    case "loopback_localhost":
      return `http://localhost:${port}${path}`;
    case "url_encoded_host":
      // Encode "127.0.0.1" as %31%32%37%2E%30%2E%30%2E%31
      return `http://%31%32%37%2E%30%2E%30%2E%31:${port}${path}`;
    case "metadata_ip":
      // Never fires our callback — but if a target follows it, that's a
      // classic metadata-service SSRF. We treat metadata_ip as "not
      // confirmed by our listener" and let the technique probe (loopback_127)
      // cover the general SSRF class.
      return `http://169.254.169.254/latest/meta-data/`;
  }
}

export async function createTestTargetSsrfBackend(
  cfg: SsrfTargetConfig,
): Promise<SsrfBackend & { close: () => void }> {
  const tokenA = await login(cfg.baseUrl, cfg.accountA.email, cfg.accountA.password);
  const listener = await startListener();
  const timeoutMs = cfg.probeTimeoutMs ?? 800;

  const impl: SsrfBackend = {
    async listEndpoints() {
      return [
        { endpoint: `${cfg.baseUrl}/api/fetch`, parameter: "url", description: "generic URL fetch" },
        { endpoint: `${cfg.baseUrl}/api/fetch-safe`, parameter: "url", description: "allowlisted URL fetch" },
      ];
    },

    async probe(_projectId: string, endpoint: string, parameter: string, technique: SsrfTechnique) {
      // metadata_ip technique won't hit our callback (we don't own that IP).
      // Report as "not bypassed" — the other techniques cover the general
      // SSRF surface against the target; metadata_ip is a stub for prod use.
      if (technique === "metadata_ip") return { bypassed: false };

      const token = randomUUID();
      const url = new URL(endpoint);
      url.searchParams.set(parameter, probeUrl(technique, listener.port, token));

      // Fire the target endpoint; we don't care about its response body.
      try {
        await fetch(url.toString(), {
          headers: { authorization: `Bearer ${tokenA}` },
          signal: AbortSignal.timeout(2000),
        });
      } catch {
        // Even a failed response can have already triggered the callback.
      }

      // Give the callback a small window to fire (it's local so this is fast).
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (listener.hits.has(token)) return { bypassed: true };
        await new Promise((r) => setTimeout(r, 40));
      }
      return { bypassed: false };
    },
  };

  return Object.assign(impl, {
    close() {
      listener.server.close();
    },
  });
}
