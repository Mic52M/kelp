// Deterministic verification of the Stage B edge-function backends against a
// local mock that mimics both a VULNERABLE and a SECURE Supabase Edge Function.
// No Anthropic, no network beyond localhost — asserts the backends' probe
// decisions directly (the LLM loop on top is already covered by the core
// specialist tests). Run: `npm run verify:edge-backends -w @kelp/worker`.

import http from "node:http";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { DiscoveredEdgeFunction } from "@kelp/core";
import {
  createEdgeAuthBypassBackend,
  createEdgeInjectionBackend,
  type EdgeBackendConfig,
} from "./supabase-native/edge-backends.js";

// Mock edge-function host:
//  · leaky-profile   trusts body.userId → returns that user's "data" (VULN)
//  · safe-profile    ignores body, always returns the caller's fixed data
//  · sqli-search     500s when the `q` param contains a single quote (VULN)
//  · clean-search    always 200 regardless of payload
function startMock(): Promise<{ server: http.Server; base: string }> {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const name = (req.url ?? "").split("?")[0]!.replace(/^\//, "");
      let body: Record<string, unknown> = {};
      try {
        const chunks: Buffer[] = [];
        for await (const ch of req) chunks.push(ch as Buffer);
        body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      } catch { /* ignore */ }

      const send = (code: number, obj: unknown) => {
        res.statusCode = code;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(obj));
      };

      if (name === "leaky-profile") return send(200, { userId: body.userId, data: `profile-of-${body.userId}` });
      if (name === "safe-profile") return send(200, { userId: "fixed-caller", data: "profile-of-fixed-caller" });
      if (name === "sqli-search") {
        const q = String(body.q ?? "");
        return q.includes("'") ? send(500, { error: "SQL syntax error near '" }) : send(200, { rows: 1 });
      }
      if (name === "clean-search") return send(200, { rows: 1 });
      return send(404, { error: "not found" });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

function fn(name: string, over: Partial<DiscoveredEdgeFunction>): DiscoveredEdgeFunction {
  return {
    name, path: `supabase/functions/${name}/index.ts`,
    bodyParams: [], queryParams: [], mutating: false, mutationReason: null,
    identityParams: [], urlParams: [], ...over,
  };
}

async function main() {
  const { server, base } = await startMock();
  try {
    const functions: DiscoveredEdgeFunction[] = [
      fn("leaky-profile", { bodyParams: ["userId"], identityParams: ["userId"] }),
      fn("safe-profile", { bodyParams: ["userId"], identityParams: ["userId"] }),
      fn("sqli-search", { bodyParams: ["q"] }),
      fn("clean-search", { bodyParams: ["q"] }),
    ];
    const cfg: EdgeBackendConfig = {
      ref: "mock", anonKey: "anon", baseUrlOverride: base, functions,
      sessionA: { accessToken: "tok-a", userId: "user-A", email: "a@test" },
      sessionB: { accessToken: "tok-b", userId: "user-B", email: "b@test" },
    };

    // ── auth-bypass ──
    const auth = createEdgeAuthBypassBackend(cfg);
    const leaky = await auth.probe("p", "leaky-profile", "userid_body_override");
    const safe = await auth.probe("p", "safe-profile", "userid_body_override");
    assert.equal(leaky.bypassed, true, "leaky-profile MUST be flagged (honors body userId)");
    assert.equal(safe.bypassed, false, "safe-profile must NOT be flagged (fixed identity)");

    // ── injection ──
    const inj = createEdgeInjectionBackend(cfg);
    const sqli = await inj.probe("p", "sqli-search", "q");
    const clean = await inj.probe("p", "clean-search", "q");
    assert.equal(sqli.bypassed, true, "sqli-search MUST be flagged (payload → 500)");
    assert.equal(clean.bypassed, false, "clean-search must NOT be flagged");

    console.log("✓ auth-bypass: leaky flagged, safe clean");
    console.log("✓ injection: sqli flagged, clean clean");
    console.log("edge-backends verify PASSED");
  } finally {
    server.close();
  }
}

main().catch((e) => {
  console.error("edge-backends verify FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
