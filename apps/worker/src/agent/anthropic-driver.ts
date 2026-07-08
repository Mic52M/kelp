// Anthropic tool-use driver for the agent loop.
//
// Implements @kelp/core's LlmAgentDriver by holding the Messages-API conversation
// state and translating between our neutral AgentTool/ToolCall/ToolResult shapes
// and Claude's tool-use content blocks.

import Anthropic from "@anthropic-ai/sdk";
import type { AgentTool, LlmAgentDriver, LlmStep, LlmUsage, ToolCall, ToolResult } from "@kelp/core";

/**
 * Mark the last message's content as a cache breakpoint so the whole
 * conversation prefix up to that point is cached on the next call. Only the
 * final block of the final message needs the marker; Anthropic caches
 * everything before it. Cheap way to stop re-billing accumulated tool results
 * (file contents, schema dumps) at full price every step.
 */
function withConversationCache(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
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

export function createAnthropicDriver(client: Anthropic, model: string): LlmAgentDriver {
  let system = "";
  let tools: Anthropic.Tool[] = [];
  let messages: Anthropic.MessageParam[] = [];
  // Cumulative token counters (issue #25). Anthropic returns `usage` on every
  // response; we sum across every step so getUsage() at run-end reflects the
  // full conversation.
  let inputTokens = 0;
  let outputTokens = 0;

  async function run(): Promise<LlmStep> {
    // Prompt caching: the system prompt + tool schemas are large and re-sent on
    // every step of an autonomous agent's loop. Marking them cacheable gives a
    // ~90% discount on those tokens after the first call — a big cost lever for
    // the long-running autonomous agents. Also cache the running conversation
    // prefix (the second-to-last user turn) so accumulated tool results aren't
    // re-billed at full price each step.
    const systemBlocks: Anthropic.TextBlockParam[] = system
      ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }]
      : [];
    const cachedTools = tools.length
      ? tools.map((t, i) =>
          i === tools.length - 1 ? { ...t, cache_control: { type: "ephemeral" as const } } : t,
        )
      : tools;
    const res = await client.messages.create({
      model,
      max_tokens: 2048,
      system: systemBlocks,
      tools: cachedTools,
      messages: withConversationCache(messages),
    });
    if (res.usage) {
      // Count cache creation + cache reads as input tokens too. This slightly
      // OVER-estimates cost (cache reads are ~10% price), which is the safe
      // direction for the monthly spend cap. input_tokens already excludes
      // cached reads, so we add them back explicitly.
      const u = res.usage as Anthropic.Usage & {
        cache_creation_input_tokens?: number | null;
        cache_read_input_tokens?: number | null;
      };
      inputTokens += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      outputTokens += u.output_tokens ?? 0;
    }
    // Preserve the full assistant turn (incl. tool_use blocks) for the next request.
    messages.push({ role: "assistant", content: res.content });

    const toolCalls: ToolCall[] = res.content
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
    async start(opts: { system: string; tools: AgentTool[]; prompt: string }): Promise<LlmStep> {
      system = opts.system;
      tools = opts.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
      }));
      messages = [{ role: "user", content: opts.prompt }];
      return run();
    },

    async provideToolResults(results: ToolResult[]): Promise<LlmStep> {
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

    getUsage(): LlmUsage {
      return { inputTokens, outputTokens, model };
    },
  };
}
