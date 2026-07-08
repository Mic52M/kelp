// Build the autonomous multi-agent pen-test campaign (the new core engine).
//
// Instead of scripted list→probe specialists, this dispatches a SQUAD of
// autonomous agents — each owns an attack surface, shares one real toolbox,
// and reasons/attacks/loops independently. The orchestrator runs them in
// parallel with crash isolation, consent gating and per-agent cost accounting
// (all unchanged).

import Anthropic from "@anthropic-ai/sdk";
import {
  createAutonomousPentester,
  DEFAULT_PENTEST_SQUAD,
  type DiscoveredEdgeFunction,
  type PentestTools,
  type SpecialistEntry,
  type SourceFile,
} from "@kelp/core";
import { createAnthropicDriver } from "./anthropic-driver.js";
import { loginSupabaseUser, resolveAnonKey, resolveServiceRoleKey } from "./supabase-native/auth.js";
import { createPentestToolbox } from "./pentest-toolbox.js";

export interface AutonomousCampaignConfig {
  supabaseRef: string;
  readonlyConnString: string;
  supabaseAnonKey: string | null;
  supabaseManagementPat: string | null;
  supabaseServiceRoleKey?: string | null;
  onDiscoveredAnonKey?: (k: string) => Promise<void>;
  onDiscoveredServiceRoleKey?: (k: string) => Promise<void>;
  accountA: { email: string; password: string };
  accountB: { email: string; password: string };
  edgeFunctions: DiscoveredEdgeFunction[];
  sourceFiles: SourceFile[];
  model?: string;
  anthropicApiKey?: string;
}

const DEFAULT_MODEL = "claude-haiku-4-5";

export async function buildAutonomousCampaign(
  cfg: AutonomousCampaignConfig,
): Promise<{ entries: SpecialistEntry<unknown, unknown>[]; toolbox: PentestTools }> {
  const apiKey = cfg.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const anonKey = await resolveAnonKey({
    projectRef: cfg.supabaseRef,
    explicitAnonKey: cfg.supabaseAnonKey,
    managementPat: cfg.supabaseManagementPat,
    onDiscovered: cfg.onDiscoveredAnonKey,
  });
  const serviceRoleKey = await resolveServiceRoleKey({
    projectRef: cfg.supabaseRef,
    managementPat: cfg.supabaseManagementPat,
    cachedServiceRole: cfg.supabaseServiceRoleKey,
    onDiscovered: cfg.onDiscoveredServiceRoleKey,
  });
  const [sessionA, sessionB] = await Promise.all([
    loginSupabaseUser({ ref: cfg.supabaseRef, anonKey, email: cfg.accountA.email, password: cfg.accountA.password, serviceRoleKey }),
    loginSupabaseUser({ ref: cfg.supabaseRef, anonKey, email: cfg.accountB.email, password: cfg.accountB.password, serviceRoleKey }),
  ]);
  if (sessionA.userId === sessionB.userId) {
    throw new Error("Test accounts A and B resolved to the same Supabase user — use two distinct accounts.");
  }

  const toolbox = createPentestToolbox({
    ref: cfg.supabaseRef,
    anonKey,
    sessionA,
    sessionB,
    readonlyConnString: cfg.readonlyConnString,
    sourceFiles: cfg.sourceFiles,
    edgeFunctions: cfg.edgeFunctions,
  });

  const client = new Anthropic({ apiKey });
  const model = cfg.model ?? DEFAULT_MODEL;

  const entries: SpecialistEntry<unknown, unknown>[] = DEFAULT_PENTEST_SQUAD.map((brief) => ({
    specialist: createAutonomousPentester(brief) as SpecialistEntry<unknown, unknown>["specialist"],
    backend: toolbox,
    driver: createAnthropicDriver(client, model),
  }));

  return { entries, toolbox };
}
