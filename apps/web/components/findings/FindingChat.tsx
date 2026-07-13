"use client";

// Per-finding chat panel (#39). Streams SSE from
// POST /api/findings/[id]/chat, renders editorial-industrial: hairline
// borders, mono for meta, restrained motion. See packages/core/src/agent/
// chat.ts for the prompt-injection defence-in-depth architecture the
// server enforces.

import { useEffect, useRef, useState } from "react";
import { MarkdownLite } from "./MarkdownLite";

interface Message {
  role: "user" | "assistant";
  content: string;
  ts?: string;
}

interface Props {
  findingId: string;
  /** Prefill hints — displayed as chips when the transcript is empty. Grounded
   *  in the finding class so they don't feel generic. */
  suggestions?: string[];
}

const DEFAULT_SUGGESTIONS = [
  "What's the impact of this on my users?",
  "Walk me through how an attacker would exploit it.",
  "What are the exact steps to fix it?",
];

export function FindingChat({ findingId, suggestions = DEFAULT_SUGGESTIONS }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedHistory, setLoadedHistory] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Lazy-load history the first time the panel opens.
  useEffect(() => {
    if (!open || loadedHistory) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/findings/${findingId}/chat/history`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(String(res.status));
        const j = (await res.json()) as { messages: Message[] };
        if (!cancelled) {
          setMessages(j.messages ?? []);
          setLoadedHistory(true);
        }
      } catch {
        // Fresh conversation OK — history endpoint returns [] on empty.
        if (!cancelled) setLoadedHistory(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, findingId, loadedHistory]);

  // Autoscroll on new content.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streaming]);

  async function send(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || streaming) return;
    setError(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setMessages((m) => [...m, { role: "assistant", content: "" }]);
    setStreaming(true);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch(`/api/findings/${findingId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text }),
        signal: ac.signal,
      });

      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          reason?: string;
        };
        setStreaming(false);
        setMessages((m) => m.slice(0, -1)); // drop the empty assistant slot
        const reasonCopy =
          j.reason === "obvious_jailbreak"
            ? "I can only answer about this finding. Try one of the suggestions."
            : j.reason === "too_long"
              ? "That message is too long — try under 800 characters."
              : j.error === "rate_limited" || j.error === "conversation_full"
                ? "You've hit the chat limit for this finding. Come back in an hour."
                : "Something went wrong. Try again in a moment.";
        setError(reasonCopy);
        return;
      }

      // Read SSE stream — application/text-event-stream.
      const reader = res.body?.getReader();
      if (!reader) throw new Error("no stream reader");
      const decoder = new TextDecoder();
      let buf = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // Parse SSE frames (event: X\ndata: {...}\n\n)
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const evMatch = frame.match(/^event:\s*(\S+)/m);
          const dataMatch = frame.match(/^data:\s*(.+)$/m);
          if (!evMatch || !dataMatch) continue;
          const eventName = evMatch[1];
          let data: unknown = {};
          try {
            data = JSON.parse(dataMatch[1]!);
          } catch {
            continue;
          }
          if (eventName === "delta") {
            const chunk = (data as { text?: string }).text ?? "";
            setMessages((m) => {
              const copy = [...m];
              const last = copy[copy.length - 1];
              if (last && last.role === "assistant") {
                copy[copy.length - 1] = { ...last, content: last.content + chunk };
              }
              return copy;
            });
          } else if (eventName === "error") {
            const msg = (data as { message?: string }).message ?? "Stream error.";
            setError(msg);
          } else if (eventName === "done") {
            // Server terminator — the reader will finish on its own too.
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError("Network issue. Try again.");
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    setStreaming(false);
  }

  if (!open) {
    return (
      <div className="mt-8">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-3 border border-[color:var(--color-signal-dim)] bg-[color:var(--color-signal)]/5 px-4 py-2.5 font-mono text-[11.5px] uppercase tracking-[0.14em] text-[color:var(--color-signal)] transition-colors hover:border-[color:var(--color-signal)] hover:bg-[color:var(--color-signal)]/10"
        >
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 animate-pulse-soft bg-[color:var(--color-signal)]"
          />
          Ask Kelp about this finding
          <span aria-hidden className="text-[color:var(--color-signal-dim)]">→</span>
        </button>
      </div>
    );
  }

  return (
    <section className="relative mt-8 border-l-2 border-[color:var(--color-signal)] bg-[color:var(--color-ink-900)]/50 shadow-[0_0_0_1px_var(--color-hair-strong)]">
      <header className="flex items-center justify-between border-b border-[color:var(--color-hair-strong)] bg-[color:var(--color-ink-900)] px-5 py-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 animate-pulse-soft bg-[color:var(--color-signal)]"
          />
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--color-paper-200)]">
            Ask Kelp — chat
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-400)] transition-colors hover:text-[color:var(--color-paper-50)]"
        >
          Close ×
        </button>
      </header>

      <div
        ref={scrollRef}
        className="max-h-[420px] min-h-[160px] overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 && loadedHistory && (
          <div className="space-y-3">
            <p className="text-[12.5px] leading-[1.65] text-[color:var(--color-paper-400)]">
              Ask about this specific finding. Kelp won't discuss anything else.
            </p>
            <div className="flex flex-col gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="text-left border border-[color:var(--color-hair)] px-3 py-2 font-mono text-[12px] text-[color:var(--color-paper-300)] transition-colors hover:border-[color:var(--color-paper-400)] hover:text-[color:var(--color-paper-50)]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.length === 0 && !loadedHistory && (
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
            Loading…
          </div>
        )}

        <ul className="space-y-5">
          {messages.map((m, i) => (
            <li key={i}>
              <div
                className={
                  m.role === "user"
                    ? "font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-paper-500)]"
                    : "font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-signal-dim)]"
                }
              >
                {m.role === "user" ? "You" : "Kelp"}
              </div>
              {m.role === "user" ? (
                <div className="mt-1.5 whitespace-pre-wrap text-[13.5px] leading-[1.65] text-[color:var(--color-paper-100)]">
                  {m.content}
                </div>
              ) : (
                <div className="mt-1.5 text-[13.5px] text-[color:var(--color-paper-200)]">
                  <MarkdownLite>{m.content}</MarkdownLite>
                  {streaming && i === messages.length - 1 && (
                    <span className="ml-1 inline-block h-3 w-1 animate-pulse bg-[color:var(--color-signal)] align-middle" />
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>

        {error && (
          <p className="mt-4 font-mono text-[11.5px] text-[color:var(--color-signal)]">
            {error}
          </p>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="border-t border-[color:var(--color-hair)] px-4 py-3"
      >
        <div className="flex items-end gap-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            maxLength={800}
            disabled={streaming}
            placeholder="Ask about this finding…"
            className="flex-1 resize-none border-0 bg-transparent px-0 py-1 font-mono text-[13px] text-[color:var(--color-paper-50)] outline-none placeholder:text-[color:var(--color-paper-500)] disabled:opacity-60"
          />
          {streaming ? (
            <button
              type="button"
              onClick={stop}
              className="border border-[color:var(--color-hair-strong)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-paper-300)] hover:border-[color:var(--color-paper-400)] hover:text-[color:var(--color-paper-50)]"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="border border-[color:var(--color-hair-strong)] bg-[color:var(--color-signal)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-ink-900)] hover:bg-[color:var(--color-signal-dim)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send
            </button>
          )}
        </div>
        <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--color-paper-500)]">
          Scoped to this finding · off-topic questions are refused
        </p>
      </form>
    </section>
  );
}
