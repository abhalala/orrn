import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { act } from "react";
import { createRoot } from "react-dom/client";

import { installDom, settle } from "./test-dom";
import { conversationKey, readConversation, useBuddyChat, writeConversation, type BuddyChat } from "./use-buddy-chat";

const env = installDom();
beforeAll(() => env.install());
afterAll(() => env.uninstall());

const enc = new TextEncoder();
type Pending = { body: Record<string, unknown>; signal: AbortSignal; push(frame: string): void; close(): void };

/** A fetch whose streams the test drives frame by frame. */
function fakeFetch() {
  const requests: Pending[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
    const signal = init.signal as AbortSignal;
    signal.addEventListener("abort", () => {
      try {
        controller.error(new DOMException("aborted", "AbortError"));
      } catch {
        // already closed
      }
    });
    requests.push({
      body: JSON.parse(String(init.body)),
      signal,
      push: (frame) => controller.enqueue(enc.encode(`data: ${frame}\n\n`)),
      close: () => controller.close(),
    });
    return new Response(stream, { status: 200 });
  }) as unknown as typeof fetch;
  return { requests, impl };
}

async function mount(fetchImpl: typeof fetch, storageKey = conversationKey("plant-1", "user-1"), onDrafts?: () => void) {
  const out: { chat: BuddyChat | null } = { chat: null };
  function Harness() {
    out.chat = useBuddyChat({ url: "http://api.test/buddy/chat", storageKey, screen: () => "/stock", onDrafts, fetchImpl });
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<Harness />));
  return {
    chat: () => out.chat!,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("useBuddyChat", () => {
  test("sends the screen and the conversation id, keeps the id in sessionStorage, refreshes drafts", async () => {
    sessionStorage.clear();
    const key = conversationKey("plant-1", "user-1");
    writeConversation(key, "c-old");
    const f = fakeFetch();
    let drafts = 0;
    const view = await mount(f.impl, key, () => drafts++);
    try {
      await act(async () => view.chat().send("  how much 12170  "));
      await settle();
      expect(f.requests[0]!.body).toEqual({ conversationId: "c-old", message: "how much 12170", screen: "/stock" });
      expect(view.chat().busy).toBe(true);
      f.requests[0]!.push(`{"type":"draft","draftId":"d1"}`);
      f.requests[0]!.push(`{"type":"done","conversationId":"c-new"}`);
      await settle();
      expect(view.chat().busy).toBe(false);
      expect(view.chat().state.turns[0]!.draftIds).toEqual(["d1"]);
      expect(readConversation(key)).toBe("c-new");
      expect(drafts).toBe(2);
    } finally {
      await view.unmount();
    }
  });

  test("a note after a confirm rides on the next turn and is gone after that turn is done", async () => {
    sessionStorage.clear();
    const f = fakeFetch();
    const view = await mount(f.impl);
    try {
      await act(async () => view.chat().addNote("draft d1 confirmed: New order"));
      await act(async () => view.chat().send("thanks"));
      await settle();
      expect(f.requests[0]!.body.notes).toEqual(["draft d1 confirmed: New order"]);
      f.requests[0]!.push(`{"type":"done","conversationId":"c1"}`);
      await settle();
      await act(async () => view.chat().send("next"));
      await settle();
      expect(f.requests[1]!.body.notes).toBeUndefined();
    } finally {
      await view.unmount();
    }
  });

  test("nothing new is sent while a turn is in flight; Retry reuses the turn", async () => {
    sessionStorage.clear();
    const f = fakeFetch();
    const view = await mount(f.impl);
    try {
      await act(async () => view.chat().send("one"));
      await act(async () => view.chat().send("two"));
      await settle();
      expect(f.requests).toHaveLength(1);
      f.requests[0]!.push(`{"type":"error","code":"offline"}`);
      await settle();
      expect(view.chat().state.offline).toBe(true);
      // No retry on its own.
      await settle(60);
      expect(f.requests).toHaveLength(1);
      await act(async () => view.chat().retry(view.chat().state.turns[0]!.id));
      await settle();
      expect(f.requests).toHaveLength(2);
      expect(f.requests[1]!.body.message).toBe("one");
      expect(view.chat().state.turns).toHaveLength(1);
    } finally {
      await view.unmount();
    }
  });

  test("New chat aborts the turn in flight, drops its late events and forgets the conversation", async () => {
    sessionStorage.clear();
    const key = conversationKey("plant-1", "user-1");
    const f = fakeFetch();
    const view = await mount(f.impl, key);
    try {
      await act(async () => view.chat().send("one"));
      await settle();
      f.requests[0]!.push(`{"type":"text","delta":"par"}`);
      await settle();
      await act(async () => view.chat().newChat());
      await settle();
      expect(f.requests[0]!.signal.aborted).toBe(true);
      expect(view.chat().state.turns).toEqual([]);
      expect(view.chat().busy).toBe(false);
      expect(readConversation(key)).toBeNull();
    } finally {
      await view.unmount();
    }
  });

  test("blocked sessionStorage does not break the chat", async () => {
    const original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(readConversation("k")).toBeNull();
      expect(() => writeConversation("k", "c1")).not.toThrow();
      const f = fakeFetch();
      const view = await mount(f.impl, "k");
      await act(async () => view.chat().send("hi"));
      await settle();
      expect(f.requests).toHaveLength(1);
      await view.unmount();
    } finally {
      if (original) Object.defineProperty(window, "sessionStorage", original);
    }
  });

  test("the key is per plant and per person", () => {
    expect(conversationKey("plant-1", "user-1")).not.toBe(conversationKey("plant-2", "user-1"));
    expect(conversationKey("plant-1", "user-1")).not.toBe(conversationKey("plant-1", "user-2"));
  });
});
