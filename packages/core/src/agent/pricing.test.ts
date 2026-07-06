import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CampaignCostCapExceeded,
  MONTHLY_CAMPAIGN_CAP_CENTS,
  assertUnderCap,
  costUsdToCents,
  estimateCostUsd,
  findModelRate,
} from "./pricing.js";

test("findModelRate matches base id and dated suffix via longest-prefix", () => {
  assert.deepEqual(findModelRate("claude-haiku-4-5"), { inputPerMTok: 1, outputPerMTok: 5 });
  assert.deepEqual(findModelRate("claude-haiku-4-5-20251001"), { inputPerMTok: 1, outputPerMTok: 5 });
  assert.deepEqual(findModelRate("claude-opus-4-8"), { inputPerMTok: 15, outputPerMTok: 75 });
});

test("findModelRate returns null for unknown models (never guesses)", () => {
  assert.equal(findModelRate("claude-something-else"), null);
  assert.equal(findModelRate("gpt-4"), null);
});

test("estimateCostUsd matches the documented per-M-token math", () => {
  // 1M input @ haiku $1 + 1M output @ haiku $5 = $6
  assert.equal(
    estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000, model: "claude-haiku-4-5" }),
    6,
  );
  // Small realistic figure to catch off-by-1e6 mistakes: 3000 in, 1500 out on opus 4.8.
  // 3000 * 15/1e6 + 1500 * 75/1e6 = 0.045 + 0.1125 = 0.1575
  const c = estimateCostUsd({ inputTokens: 3000, outputTokens: 1500, model: "claude-opus-4-8" });
  assert.equal(Math.round(c * 10000) / 10000, 0.1575);
});

test("estimateCostUsd is zero with no model or unknown model", () => {
  assert.equal(estimateCostUsd({ inputTokens: 999, outputTokens: 999 }), 0);
  assert.equal(estimateCostUsd({ inputTokens: 999, outputTokens: 999, model: "mystery" }), 0);
});

test("costUsdToCents rounds instead of flooring (tiny spends must not vanish)", () => {
  assert.equal(costUsdToCents(0.004), 0); // half a cent floor rounds down (banker default: down)
  assert.equal(costUsdToCents(0.005), 1); // half up
  assert.equal(costUsdToCents(0.017), 2);
  assert.equal(costUsdToCents(1.23), 123);
});

test("assertUnderCap blocks a projected spend that would exceed the plan cap", () => {
  // starter cap = $100 = 10000¢. Already spent $99.50 = 9950¢. Project 100¢ more => 10050 > 10000.
  assert.throws(() => assertUnderCap("starter", 9950, 100), CampaignCostCapExceeded);
});

test("assertUnderCap permits a projected spend within the cap", () => {
  assert.doesNotThrow(() => assertUnderCap("starter", 5000, 100));
});

test("assertUnderCap always blocks on the free tier (cap = 0)", () => {
  // Free tier: active pen-testing is paid-only; even 1¢ trips the cap.
  assert.throws(() => assertUnderCap("free", 0, 1), CampaignCostCapExceeded);
  assert.equal(MONTHLY_CAMPAIGN_CAP_CENTS.free, 0);
});
