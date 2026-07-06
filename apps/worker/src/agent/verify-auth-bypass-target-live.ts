// Live-driver variant of verify-auth-bypass-target (issue #26).
// Ground truth: /api/session-lookup flagged via query_as_param; /api/me is NOT.

import { authBypassSpecialist } from "@kelp/core";
import { createTestTargetAuthBypassBackend } from "./test-target-auth-bypass-backend.js";
import { runLiveVerify } from "./live-verify.js";

const BASE_URL = process.env.KELP_TEST_TARGET_URL ?? "http://localhost:4400";

type Finding = { endpoint: string; technique: string };

await runLiveVerify<Finding>({
  name: "auth-bypass",
  specialist: authBypassSpecialist,
  makeBackend: () =>
    createTestTargetAuthBypassBackend({
      baseUrl: BASE_URL,
      accountA: { email: "a@test.local", password: "secretA" },
      targetUserId: "userB",
      targetOwnedIds: ["ord_2001", "ord_2002"],
    }),
  assertions: [
    {
      message: "/api/session-lookup flagged (evidence-confirmed identity swap)",
      check: (fs) => fs.some((f) => f.endpoint.includes("/api/session-lookup")),
    },
    {
      message: "/api/me NOT flagged (no impersonation technique bypassed it)",
      check: (fs) => !fs.some((f) => f.endpoint.includes("/api/me")),
    },
  ],
});
