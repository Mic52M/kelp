// POST /api/findings/[id]/chat — SSE stream (#39).
//
// Prompt-injection hardened chat scoped to a single finding. The wire
// protocol is Server-Sent Events; the client reads it with fetch + a stream
// reader. Event names:
//
//   event: delta      — { text: "<chunk>" }             (streamed content)
//   event: usage      — { input, output, costMicroCents } (once, on finish)
//   event: refusal    — { reason, message }              (screener denial)
//   event: error      — { message }                      (system failure)
//   event: done       — {}                               (terminator)
//
// Defence-in-depth (see packages/core/src/agent/chat.ts):
//   0. Session auth (Supabase cookie) → org via ensureTenant
//   1. RLS-checked finding load (must belong to caller's org)
//   2. Deterministic user-message screener → refuse jailbreaks pre-LLM
//   3. Rate limit per finding (HOURLY_MSG_LIMIT) + conversation cap
//   4. Structured system prompt with sanitized evidence in <evidence> tags
//   5. No tools attached to the LLM stream
//   6. Post-stream validator flags system-prompt leaks (log-only for v1)

import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { ensureTenant } from "@/lib/tenant";
import {
  buildChatMessages,
  buildChatSystemPrompt,
  decideRateLimit,
  MAX_CONVERSATION_TURNS,
  screenUserMessage,
  validateAssistantOutput,
  type ChatFinding,
} from "@kelp/core";
import {
  appendConversationTurn,
  loadFindingForChat,
  loadOrCreateConversation,
} from "@kelp/worker";
import { track } from "@/lib/analytics";

// Node runtime — @anthropic-ai/sdk uses Node streams and pg needs it.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHAT_MODEL = process.env.ANTHROPIC_MODEL_CHEAP ?? "claude-haiku-4-5";
// Haiku 4.5 pricing (input / output per million tokens, USD → micro-cents).
// Reference: packages/core/src/agent/pricing.ts. Kept inline here because the
// per-turn cost is tiny and we don't need the full price ladder.
const INPUT_MC_PER_TOKEN = 100;   // $1.00/M → 100 micro-cents / token
const OUTPUT_MC_PER_TOKEN = 500;  // $5.00/M → 500 micro-cents / token

interface Body {
  message?: unknown;
}

function sseFrame(event: string, data: unknown): Uint8Array {
  const payload = JSON.stringify(data);
  return new TextEncoder().encode(`event: ${event}\ndata: ${payload}\n\n`);
}

function sseError(controller: ReadableStreamDefaultController, message: string) {
  controller.enqueue(sseFrame("error", { message }));
  controller.enqueue(sseFrame("done", {}));
  controller.close();
}

function extractEvidenceText(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  // Common shapes across our finding kinds:
  //   agent findings: { evidence: string, fix?: string }
  //   secret findings: { context: string, path: string }
  //   rls findings: { explanation: string, table: string }
  // We concatenate the most-informative strings (short paths + longer evidence).
  const bag: string[] = [];
  const r = raw as Record<string, unknown>;
  for (const key of ["evidence", "context", "reproduction", "response_body", "detail"]) {
    const v = r[key];
    if (typeof v === "string" && v.trim()) bag.push(v);
  }
  return bag.length > 0 ? bag.join("\n\n---\n\n") : null;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: findingId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(findingId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { orgId } = await ensureTenant({ id: user.id, email: user.email });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const screened = screenUserMessage(body.message);
  if (!screened.ok) {
    // Fire early — don't allocate a stream for a bounced request. Client
    // handles the 400 with a friendly banner.
    return NextResponse.json(
      { error: "refused", reason: screened.reason },
      { status: 400 },
    );
  }
  const userMessage = screened.sanitized!;

  const finding = await loadFindingForChat(findingId);
  if (!finding) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (finding.orgId !== orgId) {
    // Same 404 as truly-missing so we don't leak whether a finding id
    // exists in another org.
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const conv = await loadOrCreateConversation(findingId, orgId);
  if (conv.turnCount >= MAX_CONVERSATION_TURNS) {
    return NextResponse.json(
      { error: "conversation_full", limit: MAX_CONVERSATION_TURNS },
      { status: 429 },
    );
  }
  const now = new Date();
  const rate = decideRateLimit(now, {
    hourlyCount: conv.hourlyCount,
    windowStart: conv.hourlyWindowStart,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "chat_unavailable" }, { status: 503 });
  }

  const chatFinding: ChatFinding = {
    id: finding.id,
    vulnClass: finding.vulnClass as ChatFinding["vulnClass"],
    severity: finding.severity as ChatFinding["severity"],
    title: finding.title,
    explanation: finding.explanation,
    location: finding.location,
    evidenceText: extractEvidenceText(finding.raw),
  };
  const systemPrompt = buildChatSystemPrompt(chatFinding);
  const messages = buildChatMessages(
    conv.messages.map((m) => ({ role: m.role, content: m.content, ts: m.ts })),
    userMessage,
  );

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const client = new Anthropic({ apiKey });
      let assembled = "";
      let inputTokens = 0;
      let outputTokens = 0;
      try {
        const anthropicStream = client.messages.stream({
          model: CHAT_MODEL,
          max_tokens: 800,
          system: [
            {
              type: "text" as const,
              text: systemPrompt,
              cache_control: { type: "ephemeral" as const },
            },
          ],
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        });

        for await (const event of anthropicStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            const chunk = event.delta.text;
            assembled += chunk;
            controller.enqueue(sseFrame("delta", { text: chunk }));
          } else if (event.type === "message_delta" && event.usage) {
            outputTokens = event.usage.output_tokens ?? outputTokens;
          } else if (event.type === "message_start" && event.message.usage) {
            inputTokens = event.message.usage.input_tokens ?? 0;
          }
        }

        // Post-stream validation. v1 policy: log-only — we've already
        // streamed to the client. Persistence is where we can still gate
        // (a leak-flagged reply is NOT saved to the transcript).
        const validation = validateAssistantOutput(assembled);
        const okToPersist = validation.ok;

        const costMc =
          inputTokens * INPUT_MC_PER_TOKEN + outputTokens * OUTPUT_MC_PER_TOKEN;

        if (okToPersist) {
          const nowIso = new Date().toISOString();
          await appendConversationTurn({
            conversationId: conv.id,
            userMessage,
            assistantMessage: validation.cleaned,
            nowIso,
            nextTurnCount: conv.turnCount + 2, // user + assistant
            nextHourlyCount: rate.nextHourlyCount,
            nextHourlyWindowStart: rate.nextWindowStart,
            addedInputTokens: inputTokens,
            addedOutputTokens: outputTokens,
            addedCostMicroCents: costMc,
          });
        } else {
          console.warn(
            `chat: refused to persist assistant reply for finding=${finding.id} reason=${validation.reason}`,
          );
        }

        // TODO analytics(#34): finding.chat_turn — noun.verb_past + { reason, tokens } once catalog extends
        try {
          track(orgId, "finding.viewed", {
            findingId: finding.id,
            chatTurns: conv.turnCount + 2,
          });
        } catch { /* analytics failure never blocks the stream */ }

        controller.enqueue(
          sseFrame("usage", {
            input: inputTokens,
            output: outputTokens,
            costMicroCents: costMc,
            persisted: okToPersist,
          }),
        );
        controller.enqueue(sseFrame("done", {}));
        controller.close();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("chat stream error:", msg);
        sseError(controller, "Something went wrong. Try again.");
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no", // disable proxy buffering (nginx / vercel)
      connection: "keep-alive",
    },
  });
}
