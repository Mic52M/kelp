// Live-driver variant of verify-ssrf-target (issue #26).
// Ground truth: /api/fetch flagged as SSRF (callback listener hit);
//               /api/fetch-safe is NOT (allowlist rejects the probe URL).

import { ssrfSpecialist } from "@kelp/core";
import { createTestTargetSsrfBackend } from "./test-target-ssrf-backend.js";
import { runLiveVerify } from "./live-verify.js";

const BASE_URL = process.env.KELP_TEST_TARGET_URL ?? "http://localhost:4400";

type Finding = { endpoint: string };

await runLiveVerify<Finding>({
  name: "ssrf",
  specialist: ssrfSpecialist,
  makeBackend: () =>
    createTestTargetSsrfBackend({
      baseUrl: BASE_URL,
      accountA: { email: "a@test.local", password: "secretA" },
    }),
  assertions: [
    {
      message: "/api/fetch flagged as SSRF (callback listener recorded the hit)",
      check: (fs) => fs.some((f) => f.endpoint === "/api/fetch"),
    },
    {
      message: "/api/fetch-safe NOT flagged (allowlist rejected the probe URL)",
      check: (fs) => !fs.some((f) => f.endpoint.includes("/api/fetch-safe")),
    },
  ],
});
