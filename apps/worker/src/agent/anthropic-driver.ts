// Anthropic tool-use driver for the agent loop.
//
// Implements @kelp/core's LlmAgentDriver by holding the Messages-API conversation
// state and translating between our neutral AgentTool/ToolCall/ToolResult shapes
// and Claude's tool-use content blocks.

import Anthropic from "@anthropic-ai/sdk";
import type { AgentTool, LlmAgentDriver, LlmStep, LlmUsage, ToolCall, ToolResult } from "@kelp/core";

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
    const res = await client.messages.create({ model, max_tokens: 2048, system, tools, messages });
    if (res.usage) {
      inputTokens += res.usage.input_tokens ?? 0;
      outputTokens += res.usage.output_tokens ?? 0;
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
