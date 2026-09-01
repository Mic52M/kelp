// Pricing table (USD per million tokens). Updated 2026-09. Kept in code
// deliberately so cost math is auditable — no hidden invoicing.
//
// If Anthropic changes pricing, bump these numbers and cut a patch release.

export interface ModelPricing {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  /** Multiplier applied to input rate for cache-hit tokens. */
  cacheReadMultiplier: number;
  /** Multiplier applied to input rate for cache-write tokens. */
  cacheWriteMultiplier: number;
}

const DEFAULT: ModelPricing = {
  inputUsdPerMillion: 3.0,
  outputUsdPerMillion: 15.0,
  cacheReadMultiplier: 0.1,
  cacheWriteMultiplier: 1.25,
};

// Prefix match — any concrete date-suffixed model id (e.g.
// "claude-sonnet-5-20250929") resolves to the tier's row.
const TIERS: { prefix: string; pricing: ModelPricing }[] = [
  {
    prefix: "claude-opus-5",
    pricing: { inputUsdPerMillion: 15.0, outputUsdPerMillion: 75.0, cacheReadMultiplier: 0.1, cacheWriteMultiplier: 1.25 },
  },
  {
    prefix: "claude-sonnet-5",
    pricing: DEFAULT,
  },
  {
    prefix: "claude-haiku-4-5",
    pricing: { inputUsdPerMillion: 0.8, outputUsdPerMillion: 4.0, cacheReadMultiplier: 0.1, cacheWriteMultiplier: 1.25 },
  },
  {
    prefix: "claude-fable-5",
    pricing: DEFAULT,
  },
];

export function pricingFor(model: string): ModelPricing {
  for (const t of TIERS) if (model.startsWith(t.prefix)) return t.pricing;
  return DEFAULT;
}

/** Given raw token counts, produce cost in whole USD cents (rounded up). */
export function computeCostCents(input: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}): number {
  const p = pricingFor(input.model);
  const inputUsd = (input.inputTokens * p.inputUsdPerMillion) / 1_000_000;
  const outputUsd = (input.outputTokens * p.outputUsdPerMillion) / 1_000_000;
  const cacheReadUsd =
    (input.cacheReadTokens * p.inputUsdPerMillion * p.cacheReadMultiplier) / 1_000_000;
  const cacheWriteUsd =
    (input.cacheWriteTokens * p.inputUsdPerMillion * p.cacheWriteMultiplier) / 1_000_000;
  const totalUsd = inputUsd + outputUsd + cacheReadUsd + cacheWriteUsd;
  return Math.ceil(totalUsd * 100);
}
