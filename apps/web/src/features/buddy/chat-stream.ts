import type { ChatErrorCode, ChatEvent, ChatRequest } from "./types";

/**
 * The `/buddy/chat` client (design §13): POST the turn, read orrn's SSE back. One `TextDecoder` with `stream: true`
 * for the whole response, so a Devanagari or Gujarati letter split across two network chunks is joined, not broken;
 * a frame cut across chunks waits in the buffer for its blank line.
 */
export function createSseParser(onEvent: (event: ChatEvent) => void) {
  const decoder = new TextDecoder();
  let buffer = "";
  const frame = (raw: string) => {
    const data = raw
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) return;
    const event = parseEvent(data);
    if (event) onEvent(event);
  };
  const drain = (final: boolean) => {
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = final ? "" : (parts.pop() ?? "");
    for (const part of parts) frame(part);
  };
  return {
    push(chunk: Uint8Array) {
      buffer += decoder.decode(chunk, { stream: true });
      drain(false);
    },
    end() {
      buffer += decoder.decode();
      drain(true);
    },
  };
}

const ERROR_CODES: readonly ChatErrorCode[] = ["offline", "rate_limited", "error"];

/** One `data:` payload to an event, or null for anything that is not one of the five shapes. */
export function parseEvent(data: string): ChatEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  switch (v.type) {
    case "text":
      return typeof v.delta === "string" ? { type: "text", delta: v.delta } : null;
    case "tool":
      return typeof v.path === "string" ? { type: "tool", path: v.path } : null;
    case "draft":
      return typeof v.draftId === "string" ? { type: "draft", draftId: v.draftId } : null;
    case "done":
      return typeof v.conversationId === "string" ? { type: "done", conversationId: v.conversationId } : null;
    case "error":
      return { type: "error", code: ERROR_CODES.includes(v.code as ChatErrorCode) ? (v.code as ChatErrorCode) : "error" };
    default:
      return null;
  }
}

/** How a turn ended. `cut`: the stream closed with no `done` and no error (the answer stopped part way). */
export type TurnEnd = { kind: "done"; conversationId: string } | { kind: "error"; code: ChatErrorCode } | { kind: "cut" } | { kind: "aborted" };

/** An HTTP answer that is not a stream: 429 is the rate limit, a gateway or a refusal reads as offline. */
export function statusEnd(status: number): TurnEnd {
  if (status === 429) return { kind: "error", code: "rate_limited" };
  if (status === 403 || status === 404 || status === 502 || status === 503 || status === 504) return { kind: "error", code: "offline" };
  return { kind: "error", code: "error" };
}

export type StreamChatOptions = {
  url: string;
  body: ChatRequest;
  signal: AbortSignal;
  onEvent(event: ChatEvent): void;
  fetchImpl?: typeof fetch;
};

/** Sends one turn and streams its events. Never throws: every way it can end is a `TurnEnd`. */
export async function streamChat({ url, body, signal, onEvent, fetchImpl = fetch }: StreamChatOptions): Promise<TurnEnd> {
  // A holder, not a `let`: the parser callback sets it and the read loop checks it.
  const state: { end: TurnEnd | null } = { end: null };
  const parser = createSseParser((event) => {
    if (state.end) return;
    if (event.type === "done") state.end = { kind: "done", conversationId: event.conversationId };
    else if (event.type === "error") state.end = { kind: "error", code: event.code };
    else onEvent(event);
  });
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok || !res.body) return res.ok ? { kind: "cut" } : statusEnd(res.status);
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) parser.push(value);
      if (state.end) {
        void reader.cancel().catch(() => {});
        break;
      }
    }
    if (!state.end) parser.end();
    return state.end ?? { kind: "cut" };
  } catch {
    if (signal.aborted) return { kind: "aborted" };
    // The fetch itself failed: no network, the API host or the tunnel is down.
    return state.end ?? { kind: "error", code: "offline" };
  }
}
