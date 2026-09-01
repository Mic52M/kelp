// Minimal Anthropic tool-use driver for the CLI agent loop.
//
// Adapted from apps/worker/src/agent/anthropic-driver.ts. Kept intentionally
// small: no streaming yet (we can add token-level streaming later — the
// UX right now is one line per phase, which is plenty for a security scan).
//
// Handles the prompt-cache markers so long conversations don't rebill the
// accumulated file contents at full price.

import Anthropic from "@anthropic-ai/sdk";

export interface DriverStep {
  assistantText: string;
  toolCalls: { id: string; name: string; input: Record<string, unknown> }[];
  done: boolean;
}

export interface DriverUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface DriverToolResult {
  toolCallId: string;
  content: string;
  isError: boolean;
}

function withCacheOnLast(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1]!;
  if (typeof last.content === "string" || !Array.isArray(last.content)) return messages;
  const content = last.content.map((b, i) =>
    i === last.content.length - 1 && (b.type === "text" || b.type === "tool_result")
      ? { ...b, cache_control: { type: "ephemeral" as const } }
      : b,
  );
  return [...messages.slice(0, -1), { ...last, content } as Anthropic.MessageParam];
}

export interface CreateDriverInput {
  apiKey: string;
  model: string;
  system: string;
  tools: { name: string; description: string; input_schema: unknown }[];
  maxTokens?: number;
}

export function createDriver(cfg: CreateDriverInput) {
  const client = new Anthropic({ apiKey: cfg.apiKey });
  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: "text", text: cfg.system, cache_control: { type: "ephemeral" } },
  ];
  const cachedTools = cfg.tools.map((t, i) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool["input_schema"],
    ...(i === cfg.tools.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));
  const messages: Anthropic.MessageParam[] = [];
  const usage: DriverUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  async function run(): Promise<DriverStep> {
    const res = await client.messages.create({
      model: cfg.model,
      max_tokens: cfg.maxTokens ?? 2048,
      system: systemBlocks,
      tools: cachedTools,
      messages: withCacheOnLast(messages),
    });
    if (res.usage) {
      const u = res.usage as Anthropic.Usage & {
        cache_creation_input_tokens?: number | null;
        cache_read_input_tokens?: number | null;
      };
      usage.inputTokens += u.input_tokens ?? 0;
      usage.outputTokens += u.output_tokens ?? 0;
      usage.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
      usage.cacheReadTokens += u.cache_read_input_tokens ?? 0;
    }
    messages.push({ role: "assistant", content: res.content });

    const toolCalls = res.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }));
    const assistantText = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    return { assistantText, toolCalls, done: res.stop_reason !== "tool_use" };
  }

  return {
    async start(prompt: string): Promise<DriverStep> {
      messages.push({ role: "user", content: prompt });
      return run();
    },
    async provideResults(results: DriverToolResult[]): Promise<DriverStep> {
      messages.push({
        role: "user",
        content: results.map((r) => ({
          type: "tool_result" as const,
          tool_use_id: r.toolCallId,
          content: r.content,
          ...(r.isError ? { is_error: true } : {}),
        })),
      });
      return run();
    },
    getUsage(): DriverUsage {
      return { ...usage };
    },
  };
}
