import { useCallback, useEffect, useReducer, useRef } from "react";

import { busy, chatReducer, initialChat, type ChatState } from "./chat-model";
import { streamChat } from "./chat-stream";
import type { ChatEvent } from "./types";

/** sessionStorage key for the conversation id: one per person per plant, so a plant switch never carries a chat over. */
export function conversationKey(companyId: string, userId: string): string {
  return `orrn.buddy.conversation:${companyId}:${userId}`;
}

export function readConversation(key: string): string | null {
  try {
    const value = window.sessionStorage.getItem(key);
    return value && value.length <= 200 ? value : null;
  } catch {
    return null;
  }
}

export function writeConversation(key: string, id: string | null): void {
  try {
    if (id) window.sessionStorage.setItem(key, id);
    else window.sessionStorage.removeItem(key);
  } catch {
    // Private mode or blocked storage: the chat still works, it just starts fresh after a reload.
  }
}

export type BuddyChat = {
  state: ChatState;
  busy: boolean;
  send(message: string): void;
  retry(turnId: string): void;
  newChat(): void;
};

export type UseBuddyChatOptions = {
  url: string;
  storageKey: string;
  /** The current screen path, read when a turn is sent. */
  screen: () => string;
  /** After every finished turn and every draft event: refresh the drafts list. */
  onDrafts?: () => void;
  fetchImpl?: typeof fetch;
};

let turnCounter = 0;
const nextTurnId = () => `turn-${Date.now().toString(36)}-${(turnCounter += 1)}`;

/**
 * The conversation and the one turn in flight. New chat (and unmount, which a plant switch or sign-out causes) aborts
 * the turn, and its late events are dropped: each turn checks it is still the current one before it dispatches.
 */
export function useBuddyChat({ url, storageKey, screen, onDrafts, fetchImpl }: UseBuddyChatOptions): BuddyChat {
  const [state, dispatch] = useReducer(chatReducer, storageKey, (key) => initialChat(readConversation(key)));
  const stateRef = useRef(state);
  stateRef.current = state;
  const inflight = useRef<{ controller: AbortController; turnId: string } | null>(null);
  const onDraftsRef = useRef(onDrafts);
  onDraftsRef.current = onDrafts;

  useEffect(() => () => inflight.current?.controller.abort(), []);

  useEffect(() => {
    writeConversation(storageKey, state.conversationId);
  }, [storageKey, state.conversationId]);

  const run = useCallback(
    (turnId: string, message: string) => {
      const controller = new AbortController();
      inflight.current = { controller, turnId };
      const current = () => inflight.current?.controller === controller;
      const s = stateRef.current;
      void streamChat({
        url,
        // No `notes`: the server tells Hermes about decided drafts itself (fix round decision 7).
        body: {
          ...(s.conversationId ? { conversationId: s.conversationId } : {}),
          message,
          screen: screen(),
        },
        signal: controller.signal,
        fetchImpl,
        onEvent: (event: ChatEvent) => {
          if (!current()) return;
          dispatch({ type: "event", turnId, event });
          if (event.type === "draft") onDraftsRef.current?.();
        },
      }).then((end) => {
        if (!current()) return;
        inflight.current = null;
        dispatch({ type: "end", turnId, end });
        if (end.kind === "done") onDraftsRef.current?.();
      });
    },
    [url, screen, fetchImpl],
  );

  const send = useCallback(
    (raw: string) => {
      const message = raw.trim();
      if (!message || busy(stateRef.current)) return;
      const turnId = nextTurnId();
      dispatch({ type: "send", turnId, message });
      run(turnId, message);
    },
    [run],
  );

  const retry = useCallback(
    (turnId: string) => {
      const turn = stateRef.current.turns.find((t) => t.id === turnId);
      if (!turn || turn.phase !== "failed" || busy(stateRef.current)) return;
      dispatch({ type: "retry", turnId });
      run(turnId, turn.message);
    },
    [run],
  );

  const newChat = useCallback(() => {
    inflight.current?.controller.abort();
    inflight.current = null;
    dispatch({ type: "reset" });
  }, []);

  return { state, busy: busy(state), send, retry, newChat };
}
