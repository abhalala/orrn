import { describe, expect, test } from "bun:test";

import { chatReducer, initialChat, type ChatState } from "./chat-model";
import { createSseParser, parseEvent, statusEnd, streamChat } from "./chat-stream";
import type { ChatEvent } from "./types";

const enc = new TextEncoder();

describe("the SSE parser", () => {
  test("a Hindi letter split across two chunks comes out whole", () => {
    const events: ChatEvent[] = [];
    const parser = createSseParser((e) => events.push(e));
    const bytes = enc.encode(`data: {"type":"text","delta":"स्टॉक"}\n\n`);
    // Cut in the middle of the first Devanagari letter (3 bytes in UTF-8).
    const cut = bytes.indexOf(0xe0) + 1;
    parser.push(bytes.slice(0, cut));
    parser.push(bytes.slice(cut));
    expect(events).toEqual([{ type: "text", delta: "स्टॉक" }]);
  });

  test("a frame cut across chunks waits for its blank line; several frames in one chunk all come out", () => {
    const events: ChatEvent[] = [];
    const parser = createSseParser((e) => events.push(e));
    parser.push(enc.encode(`data: {"type":"tool","pa`));
    expect(events).toEqual([]);
    parser.push(enc.encode(`th":"stock.summary"}\n\ndata: {"type":"draft","draftId":"d1"}\r\n\r\n: keep-alive\n\ndata: {"type":"done","conversationId":"c1"}\n\n`));
    expect(events).toEqual([
      { type: "tool", path: "stock.summary" },
      { type: "draft", draftId: "d1" },
      { type: "done", conversationId: "c1" },
    ]);
  });

  test("anything that is not one of the five shapes is dropped", () => {
    expect(parseEvent("not json")).toBeNull();
    expect(parseEvent(`{"type":"text"}`)).toBeNull();
    expect(parseEvent(`{"type":"shell","cmd":"rm"}`)).toBeNull();
    expect(parseEvent(`{"type":"error","code":"weird"}`)).toEqual({ type: "error", code: "error" });
    expect(parseEvent(`{"type":"error","code":"offline"}`)).toEqual({ type: "error", code: "offline" });
  });
});

describe("statusEnd", () => {
  test("429 is the rate limit; a refusal or a gateway reads as offline; the rest is an error", () => {
    expect(statusEnd(429)).toEqual({ kind: "error", code: "rate_limited" });
    for (const s of [403, 404, 502, 503, 504]) expect(statusEnd(s)).toEqual({ kind: "error", code: "offline" });
    expect(statusEnd(500)).toEqual({ kind: "error", code: "error" });
  });
});

function sseResponse(frames: string[], status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { "content-type": "text/event-stream" } });
}

describe("streamChat", () => {
  const body = { message: "how much 12170 is in the yard", screen: "/today" };

  test("posts the turn with the session cookie and ends on done", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const events: ChatEvent[] = [];
    const end = await streamChat({
      url: "http://api.test/buddy/chat",
      body,
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen.push({ url, init });
        return sseResponse([`data: {"type":"text","delta":"About "}\n\n`, `data: {"type":"text","delta":"500 kg"}\n\ndata: {"type":"done","conversationId":"c9"}\n\n`]);
      }) as unknown as typeof fetch,
    });
    expect(end).toEqual({ kind: "done", conversationId: "c9" });
    expect(events).toEqual([
      { type: "text", delta: "About " },
      { type: "text", delta: "500 kg" },
    ]);
    expect(seen[0]!.init.credentials).toBe("include");
    expect(seen[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual(body);
  });

  test("a stream that closes with no done is cut", async () => {
    const end = await streamChat({
      url: "x",
      body,
      signal: new AbortController().signal,
      onEvent: () => {},
      fetchImpl: (async () => sseResponse([`data: {"type":"text","delta":"Half"}\n\n`])) as unknown as typeof fetch,
    });
    expect(end).toEqual({ kind: "cut" });
  });

  test("an error event ends the turn with its code", async () => {
    const end = await streamChat({
      url: "x",
      body,
      signal: new AbortController().signal,
      onEvent: () => {},
      fetchImpl: (async () => sseResponse([`data: {"type":"error","code":"offline"}\n\n`])) as unknown as typeof fetch,
    });
    expect(end).toEqual({ kind: "error", code: "offline" });
  });

  test("a failed fetch is offline, an aborted one is aborted", async () => {
    const failing = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await streamChat({ url: "x", body, signal: new AbortController().signal, onEvent: () => {}, fetchImpl: failing })).toEqual({ kind: "error", code: "offline" });
    const controller = new AbortController();
    controller.abort();
    expect(await streamChat({ url: "x", body, signal: controller.signal, onEvent: () => {}, fetchImpl: failing })).toEqual({ kind: "aborted" });
  });

  test("an HTTP 429 is the rate limit", async () => {
    const end = await streamChat({ url: "x", body, signal: new AbortController().signal, onEvent: () => {}, fetchImpl: (async () => new Response("", { status: 429 })) as unknown as typeof fetch });
    expect(end).toEqual({ kind: "error", code: "rate_limited" });
  });
});

describe("the conversation reducer", () => {
  const send = (s: ChatState, turnId: string, message = "hello") => chatReducer(s, { type: "send", turnId, message });

  test("streamed text builds the reply; the live region speaks only when the turn is done", () => {
    let s = send(initialChat(), "t1");
    s = chatReducer(s, { type: "event", turnId: "t1", event: { type: "text", delta: "Hel" } });
    s = chatReducer(s, { type: "event", turnId: "t1", event: { type: "tool", path: "stock.summary" } });
    s = chatReducer(s, { type: "event", turnId: "t1", event: { type: "text", delta: "lo" } });
    expect(s.turns[0]).toMatchObject({ phase: "streaming", reply: "Hello", tools: ["stock.summary"] });
    expect(s.announce).toBeNull();
    s = chatReducer(s, { type: "end", turnId: "t1", end: { kind: "done", conversationId: "c1" } });
    expect(s.turns[0]!.phase).toBe("done");
    expect(s.conversationId).toBe("c1");
    expect(s.announce).toEqual({ turnId: "t1", kind: "reply" });
  });

  test("Retry runs the same turn again: no second message from the person", () => {
    let s = send(initialChat("c1"), "t1");
    s = chatReducer(s, { type: "event", turnId: "t1", event: { type: "text", delta: "par" } });
    s = chatReducer(s, { type: "end", turnId: "t1", end: { kind: "cut" } });
    expect(s.turns[0]).toMatchObject({ phase: "failed", error: "cut" });
    s = chatReducer(s, { type: "retry", turnId: "t1" });
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0]).toMatchObject({ phase: "connecting", reply: "", error: null, message: "hello" });
  });

  test("offline is set by an offline turn and cleared by the next good one", () => {
    let s = send(initialChat(), "t1");
    s = chatReducer(s, { type: "end", turnId: "t1", end: { kind: "error", code: "offline" } });
    expect(s.offline).toBe(true);
    expect(s.announce).toEqual({ turnId: "t1", kind: "offline" });
    s = chatReducer(s, { type: "retry", turnId: "t1" });
    s = chatReducer(s, { type: "end", turnId: "t1", end: { kind: "done", conversationId: "c2" } });
    expect(s.offline).toBe(false);
  });

  test("the chat keeps no note queue: the server tells Hermes about decided drafts (decision 7)", () => {
    const s = send(initialChat("c1"), "t1");
    expect(Object.keys(s)).not.toContain("notes");
    expect(Object.keys(s.turns[0]!)).not.toContain("notes");
  });

  test("late events after a turn ended change nothing; an aborted end changes nothing", () => {
    let s = send(initialChat(), "t1");
    s = chatReducer(s, { type: "end", turnId: "t1", end: { kind: "done", conversationId: "c1" } });
    const after = chatReducer(s, { type: "event", turnId: "t1", event: { type: "text", delta: "late" } });
    expect(after.turns[0]!.reply).toBe("");
    const s2 = send(initialChat(), "t2");
    expect(chatReducer(s2, { type: "end", turnId: "t2", end: { kind: "aborted" } })).toBe(s2);
  });

  test("a draft event lists the draft once", () => {
    let s = send(initialChat(), "t1");
    s = chatReducer(s, { type: "event", turnId: "t1", event: { type: "draft", draftId: "d1" } });
    s = chatReducer(s, { type: "event", turnId: "t1", event: { type: "draft", draftId: "d1" } });
    expect(s.turns[0]!.draftIds).toEqual(["d1"]);
  });

  test("New chat drops the conversation and its turns", () => {
    let s = send(initialChat("c1"), "t1");
    s = chatReducer(s, { type: "reset" });
    expect(s).toEqual(initialChat(null));
  });
});
