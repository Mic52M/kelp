// Live-driver variant of verify-injection-target (issue #26).
// Ground truth: /api/orders/search flagged as injection; /api/orders/find is NOT.

import { injectionSpecialist } from "@kelp/core";
import { createTestTargetInjectionBackend } from "./test-target-injection-backend.js";
import { runLiveVerify } from "./live-verify.js";

const BASE_URL = process.env.KELP_TEST_TARGET_URL ?? "http://localhost:4400";

type Finding = { endpoint: string };

await runLiveVerify<Finding>({
  name: "injection",
  specialist: injectionSpecialist,
  makeBackend: () =>
    createTestTargetInjectionBackend({
      baseUrl: BASE_URL,
      accountA: { email: "a@test.local", password: "secretA" },
    }),
  assertions: [
    {
      message: "/api/orders/search flagged as injection (payload widens result vs baseline)",
      check: (fs) => fs.some((f) => f.endpoint.includes("/api/orders/search")),
    },
    {
      message: "/api/orders/find NOT flagged (parameterised — no bypass)",
      check: (fs) => !fs.some((f) => f.endpoint.includes("/api/orders/find")),
    },
  ],
});
