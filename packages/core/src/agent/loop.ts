// Generic agentic tool-use loop.
//
// The LLM plans and decides which tools to call; a deterministic ToolExecutor
// runs them and feeds results back. The loop is model-agnostic: the concrete
// Anthropic driver lives in the worker, while tests inject a scripted driver —
// so the control flow (dispatch, termination, step cap) is fully testable
// without any API call.

export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema for the tool input. */
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export interface LlmStep {
  /** any assistant narration for this step */
  assistantText: string;
  /** tools the model wants to run this step */
  toolCalls: ToolCall[];
  /** true when the model has finished (no more tool calls expected) */
  done: boolean;
}

/**
 * Cumulative token usage a driver reports across every model call in its run.
 * `model` is optional — scripted drivers used in unit tests have no model to
 * price against; only the real (Anthropic) driver populates it. The orchestrator
 * uses model + tokens to estimate cost per specialist.
 */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  /** Driver's model id, used for cost estimation (e.g. "claude-opus-4-8"). */
  model?: string;
}

/** Drives a single tool-use conversation. The driver owns message state. */
export interface LlmAgentDriver {
  start(opts: { system: string; tools: AgentTool[]; prompt: string }): Promise<LlmStep>;
  provideToolResults(results: ToolResult[]): Promise<LlmStep>;
  /**
   * Optional: cumulative token usage since `start()`. Drivers that don't call an
   * LLM (scripted test drivers) may omit this. The orchestrator treats a missing
   * `getUsage` as "cost accounting not available for this specialist" — not an
   * error — so tests keep working.
   */
  getUsage?(): LlmUsage;
}

/** Executes tool calls deterministically. */
export interface ToolExecutor {
  execute(call: ToolCall): Promise<ToolResult>;
}

export interface AgentRunResult {
  steps: number;
  transcript: string[];
}

/**
 * Run the agent to completion (or until maxSteps). Returns the assistant's
 * narration transcript; findings are collected by the executor itself.
 */
export async function runAgent(
  driver: LlmAgentDriver,
  executor: ToolExecutor,
  opts: { system: string; tools: AgentTool[]; prompt: string; maxSteps?: number },
): Promise<AgentRunResult> {
  const maxSteps = opts.maxSteps ?? 12;
  const transcript: string[] = [];

  let step = await driver.start({ system: opts.system, tools: opts.tools, prompt: opts.prompt });
  let n = 0;

  while (true) {
    if (step.assistantText) transcript.push(step.assistantText);
    if (step.done || step.toolCalls.length === 0) break;
    if (n >= maxSteps) break;
    n++;

    const results: ToolResult[] = [];
    for (const call of step.toolCalls) {
      results.push(await executor.execute(call));
    }
    step = await driver.provideToolResults(results);
  }

  return { steps: n, transcript };
}
