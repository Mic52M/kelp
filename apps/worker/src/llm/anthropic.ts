// Anthropic (Claude) integration for Kelp's reasoning layer.
//
// Two-model strategy (see issue #8): a strong model for planning/agentic reasoning
// and fix generation, a cheap fast model for high-volume work (plain-language
// explanations, triage). Both configurable via env.
//
// The deterministic scanners stay the source of truth; Claude sits ON TOP of them
// — explaining, planning, and (later) driving the agentic pentest loop. It never
// decides on its own whether a finding is real.

import Anthropic from "@anthropic-ai/sdk";

export const MODELS = {
  /** planning, agentic tool-use, fix generation */
  reasoning: process.env.ANTHROPIC_MODEL_REASONING ?? "claude-opus-4-8",
  /** high-volume: explanations, triage */
  cheap: process.env.ANTHROPIC_MODEL_CHEAP ?? "claude-haiku-4-5",
} as const;

/** Reads ANTHROPIC_API_KEY (or an `ant` profile) from the environment. */
export function createLlmClient(): Anthropic {
  return new Anthropic();
}

export interface CompleteOptions {
  model: string;
  system: string;
  prompt: string;
  maxTokens?: number;
}

/** One-shot text completion. Concatenates the text blocks of the reply. */
export async function completeText(
  client: Anthropic,
  { model, system, prompt, maxTokens = 1024 }: CompleteOptions,
): Promise<string> {
  const res = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
  });
  if (res.stop_reason === "refusal") {
    throw new Error("Claude declined to answer this request");
  }
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export interface FindingForExplanation {
  vulnClass: string;
  severity: string;
  title: string;
  location: string | null;
  explanation: string;
}

const EXPLAIN_SYSTEM =
  "You are Kelp, a security expert who helps solo founders and small teams that " +
  "built their app with AI tools (Lovable, Bolt, Cursor) and have little security " +
  "background. Explain findings in plain, calm, concrete language — never alarmist, " +
  "never jargon-heavy. Two or three short sentences: what it means, what an attacker " +
  "could actually do, and that a fix is available. Do not restate the title verbatim. " +
  "Do not invent details beyond what you are given.";

/** Rewrite a finding's technical detail as a reassuring, plain-language explanation. */
export async function explainFinding(
  client: Anthropic,
  finding: FindingForExplanation,
): Promise<string> {
  const prompt =
    `Vulnerability class: ${finding.vulnClass}\n` +
    `Severity: ${finding.severity}\n` +
    `Title: ${finding.title}\n` +
    `Location: ${finding.location ?? "n/a"}\n` +
    `Technical detail: ${finding.explanation}\n\n` +
    `Explain this to the founder in plain language.`;
  return completeText(client, {
    model: MODELS.cheap,
    system: EXPLAIN_SYSTEM,
    prompt,
    maxTokens: 400,
  });
}
