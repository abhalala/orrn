/**
 * Buddy shapes from the build contract (design 2026-11-18 §13). The bubble and the Settings tab take these as props,
 * so their bodies render and test without the tRPC hooks; the containers pass the server's rows straight through.
 */
export type DraftStatus = "pending" | "confirmed" | "rejected" | "expired" | "failed";

export type DraftKind = "procedure" | "answers" | "dryRun";

/** One input field as the card shows it (never cut on the server). `key` is the input key Hermes sent. */
export type DraftField = { key: string; label: string; value: string };
/** One entry of a list the draft runs, e.g. every answer of an "answers" draft. */
export type DraftItem = { label: string; value: string };

/**
 * One row of `buddy.drafts.listMine`: BuddyDraftView v2 of the fix-round contract (it replaced `lines`). The card shows
 * exactly what Confirm runs: every field and every item.
 */
export type BuddyDraft = {
  id: string;
  path: string;
  kind: DraftKind;
  /** English fallback; the card says known paths in the person's language. */
  title: string;
  fields: readonly DraftField[];
  items: readonly DraftItem[] | null;
  status: DraftStatus;
  createdAt: string | number | Date;
  expiresAt: string | number | Date;
  result?: unknown;
  failure: string | null;
  link: string | null;
  /** "chat": made in the Buddy chat; "other": another Hermes place (Telegram, a cron); null: not known. */
  origin: "chat" | "other" | null;
  decidedVia: "bubble" | "settings" | null;
  /** A confirmed row-check draft the browser has not reported yet: the bubble drives `ingest.dryRun.step`. */
  drive: { kind: "dryRun"; candidateId: string } | null;
};

/** What `POST /buddy/chat` streams back, one JSON object per SSE `data:` line. */
export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; path: string }
  | { type: "draft"; draftId: string }
  | { type: "done"; conversationId: string }
  | { type: "error"; code: ChatErrorCode };

export type ChatErrorCode = "offline" | "rate_limited" | "error";

/** Body of `POST /buddy/chat`. Notes about decided drafts are the server's job now (fix round decision 7). */
export type ChatRequest = { conversationId?: string; message: string; screen: string };
