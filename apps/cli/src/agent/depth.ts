// Depth presets — one flag `--depth` picks a coherent combo of model +
// cost cap + iteration cap + prompt aggressiveness. Users who want to
// override individual knobs can still pass --model / --max-cost-cents /
// --max-iterations explicitly (they win over the preset defaults).

export type Depth = "quick" | "standard" | "thorough" | "paranoid";

export interface DepthPreset {
  model: string;
  maxCostCents: number;
  maxIterations: number;
}

export const DEPTH_PRESETS: Record<Depth, DepthPreset> = {
  quick: {
    model: "claude-haiku-4-5",
    maxCostCents: 15,
    maxIterations: 10,
  },
  standard: {
    model: "claude-sonnet-5",
    maxCostCents: 100,
    maxIterations: 24,
  },
  thorough: {
    model: "claude-sonnet-5",
    maxCostCents: 300,
    maxIterations: 40,
  },
  paranoid: {
    model: "claude-opus-5",
    maxCostCents: 1000,
    maxIterations: 80,
  },
};

export function resolveDepth(
  depth: Depth | null,
  overrides: { model?: string; maxCostCents?: number; maxIterations?: number },
): DepthPreset {
  const base = DEPTH_PRESETS[depth ?? "standard"];
  return {
    model: overrides.model ?? base.model,
    maxCostCents: overrides.maxCostCents ?? base.maxCostCents,
    maxIterations: overrides.maxIterations ?? base.maxIterations,
  };
}

export function isDepth(v: string): v is Depth {
  return v === "quick" || v === "standard" || v === "thorough" || v === "paranoid";
}
