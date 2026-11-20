/**
 * Buddy shapes from the build contract (design 2026-11-18 §13). The bubble and the Settings tab take these as props,
 * so their bodies render and test without the tRPC hooks; the containers pass the server's rows straight through.
 */
export type DraftStatus = "pending" | "confirmed" | "rejected" | "expired" | "failed";

/** One row of `buddy.drafts.listMine`. */
export type BuddyDraft = {
  id: string;
  path: string;
  title: string;
  lines: readonly { label: string; value: string }[];
  status: DraftStatus;
  createdAt: string | number | Date;
  expiresAt: string | number | Date;
  result?: unknown;
  failure: string | null;
  link: string | null;
};

/** What `POST /buddy/chat` streams back, one JSON object per SSE `data:` line. */
export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; path: string }
  | { type: "draft"; draftId: string }
  | { type: "done"; conversationId: string }
  | { type: "error"; code: ChatErrorCode };

export type ChatErrorCode = "offline" | "rate_limited" | "error";

/** Body of `POST /buddy/chat`. */
export type ChatRequest = { conversationId?: string; message: string; screen: string; notes?: string[] };
