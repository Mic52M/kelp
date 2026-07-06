// Live-driver variant of verify-weak-crypto-target (issue #26).
// Ground truth: /api/set-insecure-cookie flagged (missing required flags);
//               /api/set-secure-cookie is NOT (HttpOnly + Secure + SameSite all present).

import { weakCryptoSpecialist } from "@kelp/core";
import { createTestTargetWeakCryptoBackend } from "./test-target-weak-crypto-backend.js";
import { runLiveVerify } from "./live-verify.js";

const BASE_URL = process.env.KELP_TEST_TARGET_URL ?? "http://localhost:4400";

type Finding = { endpoint: string };

await runLiveVerify<Finding>({
  name: "weak-crypto",
  specialist: weakCryptoSpecialist,
  makeBackend: () =>
    createTestTargetWeakCryptoBackend({
      baseUrl: BASE_URL,
      accountA: { email: "a@test.local", password: "secretA" },
    }),
  assertions: [
    {
      message: "/api/set-insecure-cookie flagged (missing required cookie flags)",
      check: (fs) => fs.some((f) => f.endpoint.includes("/api/set-insecure-cookie")),
    },
    {
      message: "/api/set-secure-cookie NOT flagged (HttpOnly + Secure + SameSite all present)",
      check: (fs) => !fs.some((f) => f.endpoint.includes("/api/set-secure-cookie")),
    },
  ],
});
