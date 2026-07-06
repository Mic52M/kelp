// Live-driver variant of verify-bola-target (issue #26). Uses the real
// Anthropic driver; opts in only when KELP_ANTHROPIC_LIVE=1. Mirrors the
// scripted verify's ground truth: /api/orders/:id is flagged, /api/profiles/:id
// is NOT.

import { bolaSpecialist } from "@kelp/core";
import { createTestTargetBolaBackend } from "./test-target-backend.js";
import { runLiveVerify } from "./live-verify.js";

const BASE_URL = process.env.KELP_TEST_TARGET_URL ?? "http://localhost:4400";

type Finding = { endpoint: string };

await runLiveVerify<Finding>({
  name: "bola",
  specialist: bolaSpecialist,
  makeBackend: () =>
    createTestTargetBolaBackend({
      baseUrl: BASE_URL,
      accountA: { email: "a@test.local", password: "secretA" },
      accountB: { email: "b@test.local", password: "secretB" },
      bOwnedIds: ["ord_2001", "ord_2002", "prf_b"],
    }),
  assertions: [
    {
      message: "/api/orders/:id flagged as BOLA (evidence-confirmed)",
      check: (fs) => fs.some((f) => f.endpoint.includes("/api/orders/")),
    },
    {
      message: "/api/profiles/:id NOT flagged (correctly denied cross-account)",
      check: (fs) => !fs.some((f) => f.endpoint.includes("/api/profiles/")),
    },
  ],
});
