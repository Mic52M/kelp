// Live-driver variant of verify-exposure-target (issue #26).
// Ground truth: /api/admin/users-with-hashes flagged as exposure (sensitive
//               fields); /api/public-users is NOT (only id + display_name).

import { exposureSpecialist } from "@kelp/core";
import { createTestTargetExposureBackend } from "./test-target-exposure-backend.js";
import { runLiveVerify } from "./live-verify.js";

const BASE_URL = process.env.KELP_TEST_TARGET_URL ?? "http://localhost:4400";

type Finding = { endpoint: string };

await runLiveVerify<Finding>({
  name: "exposure",
  specialist: exposureSpecialist,
  makeBackend: () =>
    createTestTargetExposureBackend({
      baseUrl: BASE_URL,
      accountA: { email: "a@test.local", password: "secretA" },
    }),
  assertions: [
    {
      message: "/api/admin/users-with-hashes flagged as exposure (sensitive field names detected)",
      check: (fs) => fs.some((f) => f.endpoint.includes("/api/admin/users-with-hashes")),
    },
    {
      message: "/api/public-users NOT flagged (only id + display_name)",
      check: (fs) => !fs.some((f) => f.endpoint.includes("/api/public-users")),
    },
  ],
});
