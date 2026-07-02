// Live agentic BOLA demo — Claude drives the tools against a mock target.
//
//   npm run build
//   node --env-file=.env.local apps/worker/dist/agent-demo.js
//
// Proves the agent loop works end-to-end with the real model: Claude lists
// endpoints, decides what to probe, and reports only what a probe confirmed.
// The target is mocked (no real app needed), but the reasoning is real.

import { runBolaAgent, type BolaProbeBackend } from "@kelp/core";
import { createLlmClient, MODELS } from "./llm/anthropic.js";
import { createAnthropicDriver } from "./agent/anthropic-driver.js";
import { consentStoreFor, consoleAudit } from "./connectors/mock.js";

// A mock target: two endpoints leak across accounts, two are properly scoped.
const backend: BolaProbeBackend = {
  async listEndpoints() {
    return [
      { endpoint: "GET /rest/v1/invoices?id=eq.{id}", resourceKind: "invoice", idParameter: "id" },
      { endpoint: "GET /rest/v1/profiles?id=eq.{id}", resourceKind: "profile", idParameter: "id" },
      { endpoint: "GET /rest/v1/bookings?id=eq.{id}", resourceKind: "booking", idParameter: "id" },
      { endpoint: "GET /rest/v1/orders?id=eq.{id}", resourceKind: "order", idParameter: "id" },
    ];
  },
  async probe(_p, endpoint) {
    const leaks = endpoint.includes("invoices") || endpoint.includes("bookings");
    return { crossAccountAccess: leaks };
  },
};

async function main() {
  const client = createLlmClient();
  const driver = createAnthropicDriver(client, MODELS.reasoning);

  console.log(`\nKelp agentic BOLA test — driven by ${MODELS.reasoning}\n`);

  const { findings, transcript } = await runBolaAgent(
    { driver, backend, consent: consentStoreFor(new Set(["demo-project"])), audit: consoleAudit },
    { orgId: "demo-org", projectId: "demo-project", jobId: "job_agent_1" },
  );

  console.log("\n— agent narration —");
  for (const line of transcript) if (line) console.log(`  ${line}`);

  console.log(`\n— confirmed findings (${findings.length}) —`);
  for (const f of findings) {
    console.log(`  🟠 ${f.title}`);
    console.log(`       ↳ ${f.endpoint}  · queued for human review`);
  }
  console.log();
}

main().catch((e) => {
  console.error("agent-demo failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
