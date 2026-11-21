import type { TurnEnd } from "./chat-stream";
import type { ChatErrorCode, ChatEvent } from "./types";

/**
 * The bubble's conversation as a pure reducer. One turn is the person's message and Buddy's answer to it; Retry runs
 * the same turn again (no second "You" line). orrn stores no chat text (design §4.1): this lives in memory only, and
 * the conversation id alone is kept in sessionStorage. Notes to Hermes about decided drafts are not kept here: the
 * server sends the final state of each draft with the next turn (fix round decision 7), so they survive a reload and
 * include decisions made in Settings > Buddy.
 */
export type TurnPhase = "connecting" | "streaming" | "done" | "failed";
export type TurnError = ChatErrorCode | "cut";

export type Turn = {
  id: string;
  message: string;
  reply: string;
  tools: string[];
  draftIds: string[];
  phase: TurnPhase;
  error: TurnError | null;
};

export type ChatState = {
  conversationId: string | null;
  turns: Turn[];
  /** The last turn could not reach Buddy. One line in the panel; nothing retries on its own. */
  offline: boolean;
  /** What the live region says: the finished answer, or what went wrong. Never a streamed token. */
  announce: { turnId: string; kind: "reply" | TurnError } | null;
};

export type ChatAction =
  | { type: "send"; turnId: string; message: string }
  | { type: "retry"; turnId: string }
  | { type: "event"; turnId: string; event: ChatEvent }
  | { type: "end"; turnId: string; end: TurnEnd }
  | { type: "reset" };

export function initialChat(conversationId: string | null = null): ChatState {
  return { conversationId, turns: [], offline: false, announce: null };
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "send":
      return {
        ...state,
        turns: [
          ...state.turns,
          { id: action.turnId, message: action.message, reply: "", tools: [], draftIds: [], phase: "connecting", error: null },
        ],
      };
    case "retry":
      return mapTurn(state, action.turnId, (turn) => ({ ...turn, reply: "", tools: [], draftIds: [], phase: "connecting", error: null }));
    case "event":
      return mapTurn(state, action.turnId, (turn) => {
        if (turn.phase === "done" || turn.phase === "failed") return turn;
        const event = action.event;
        if (event.type === "text") return { ...turn, phase: "streaming", reply: turn.reply + event.delta };
        if (event.type === "tool") return { ...turn, phase: "streaming", tools: [...turn.tools, event.path] };
        if (event.type === "draft") {
          return turn.draftIds.includes(event.draftId) ? turn : { ...turn, phase: "streaming", draftIds: [...turn.draftIds, event.draftId] };
        }
        return turn;
      });
    case "end": {
      const turn = state.turns.find((t) => t.id === action.turnId);
      if (!turn || turn.phase === "done" || turn.phase === "failed") return state;
      const end = action.end;
      if (end.kind === "aborted") return state;
      if (end.kind === "done") {
        return {
          ...mapTurn(state, turn.id, (t) => ({ ...t, phase: "done", error: null })),
          conversationId: end.conversationId,
          offline: false,
          announce: { turnId: turn.id, kind: "reply" },
        };
      }
      const error: TurnError = end.kind === "cut" ? "cut" : end.code;
      return {
        ...mapTurn(state, turn.id, (t) => ({ ...t, phase: "failed", error })),
        offline: error === "offline",
        announce: { turnId: turn.id, kind: error },
      };
    }
    case "reset":
      return initialChat(null);
  }
}

function mapTurn(state: ChatState, id: string, fn: (turn: Turn) => Turn): ChatState {
  return { ...state, turns: state.turns.map((t) => (t.id === id ? fn(t) : t)) };
}

/** A turn is in flight from send until done or failed; the box sends nothing new meanwhile. */
export function busy(state: ChatState): boolean {
  return state.turns.some((t) => t.phase === "connecting" || t.phase === "streaming");
}
