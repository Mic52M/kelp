// Live-driver variant of verify-rls-deep-target (issue #26).
// Ground truth: orders_public flagged (RLS off — cross-account read succeeds);
//               orders_scoped is NOT (RLS on, deny).

import { rlsDeepSpecialist } from "@kelp/core";
import { createTestTargetRlsDeepBackend } from "./test-target-rls-deep-backend.js";
import { runLiveVerify } from "./live-verify.js";

const BASE_URL = process.env.KELP_TEST_TARGET_URL ?? "http://localhost:4400";

type Finding = { table: string };

await runLiveVerify<Finding>({
  name: "rls-deep",
  specialist: rlsDeepSpecialist,
  makeBackend: () =>
    createTestTargetRlsDeepBackend({
      baseUrl: BASE_URL,
      accountA: { email: "a@test.local", password: "secretA" },
      targetOwnerId: "userB",
    }),
  assertions: [
    {
      message: "orders_public flagged (RLS off — evidence-confirmed cross-account read)",
      check: (fs) => fs.some((f) => f.table === "orders_public"),
    },
    {
      message: "orders_scoped NOT flagged (RLS enforced the deny)",
      check: (fs) => !fs.some((f) => f.table === "orders_scoped"),
    },
  ],
});
