/**
 * Shapes the `buddy` router returns (design 2026-11-18, §13). Dates are ISO strings (this API has no
 * data transformer).
 */
import type { BuddyCallOutcome, BuddyDraftDecidedVia, BuddyDraftKind, BuddyDraftStatus } from "@orrn/db/schema";

export type BuddyStatusView = {
  /** The person may use the buddy here and the four `HERMES_*` names are set on this stage. */
  available: boolean;
  /** The plant is in `BUDDY_COMPANIES`, so "Connect Hermes" may make a grant. */
  listed: boolean;
  connected: { grantId: string; createdAt: string; lastUsedAt: string | null; expiresAt: string | null } | null;
};

export type BuddyGrantCreated = {
  grantId: string;
  /** Shown once. orrn keeps only its SHA-256. */
  token: string;
};

export type BuddyCallView = {
  id: string;
  /** `orrn_search`, `orrn_describe`, `orrn_call`, `orrn_review_link`, or `chat` (one chat turn, no text). */
  tool: string;
  path: string | null;
  outcome: BuddyCallOutcome;
  ms: number;
  resultBytes: number;
  platform: string | null;
  at: string;
};

/**
 * One input field of a draft as the card shows it: never cut (v3, delta round decisions 5 and 10).
 * - `value`: the resolved name or code when `ref.name` is set, else the raw value (ids stay visible). For an `*Ids`
 *   list, `name (id)` per entry (the id alone when no name was found).
 * - `ref`: set for every single id field the server resolves (key `id`, `*Id`); `name` null when no row of this plant
 *   has that id. Null for `*Ids` lists and for fields that are not ids.
 * - `marked`: the raw value held bidi controls (U+202A..U+202E, U+2066..U+2069); `value` shows each as `⟦U+202E⟧`.
 */
export type BuddyDraftField = {
  key: string;
  label: string;
  value: string;
  ref: { id: string; name: string | null } | null;
  marked: boolean;
};
/** One entry of a list the draft runs (e.g. every answer of an "answers" draft): never cut. */
export type BuddyDraftItem = { label: string; value: string };

/**
 * A draft as the card shows it (v2, fix round decision 9): exactly what Confirm runs. `expectSeq` and the request
 * keys are not shown because Confirm fills them in; `candidateId`/`artifactId` show as the sheet or file name.
 */
export type BuddyDraftView = {
  id: string;
  /** The procedure path, or `import.answerQuestions` / `import.runDryRun` for a composite import draft. */
  path: string;
  kind: BuddyDraftKind;
  /** The procedure in plain English (fallback; the web maps known paths to the person's language). */
  title: string;
  /** Every input field, in the order the model sent it. */
  fields: BuddyDraftField[];
  /** Every entry of the list the draft runs, or null. */
  items: BuddyDraftItem[] | null;
  status: BuddyDraftStatus;
  createdAt: string;
  expiresAt: string;
  /** The real mutation's result after a confirm, else null. */
  result: unknown;
  failure: string | null;
  /** For an import draft: the web path of the review page (`/ingest/review/<id>` or `/ingest/files/<id>`). */
  link: string | null;
  /** Where the draft came from: the buddy chat (`x-hermes-platform: api_server`), another Hermes platform, or unknown. */
  origin: "chat" | "other" | null;
  decidedVia: BuddyDraftDecidedVia | null;
  /** A confirmed dry run draft whose run the browser has not reported yet: the bubble drives `ingest.dryRun.step`. */
  drive: { kind: "dryRun"; candidateId: string } | null;
  /** The change cannot be undone (delete, cancel, merge, close, void, remove, retire, revoke, discard, ...). */
  irreversible: boolean;
  /**
   * Set when `irreversible` and some id field has no name in this plant (`unnamed_id`) or some value holds bidi
   * controls (`bidi`): Confirm is refused by the server (PRECONDITION_FAILED, `data.meta.reason = "CONFIRM_BLOCKED"`)
   * and the card disables it. `keys` are the input keys at fault. Reject still works.
   */
  confirmBlock: null | { reason: "unnamed_id" | "bidi"; keys: string[] };
};

/** `data.meta.reason` of the refusal when Confirm is pressed on a draft with `confirmBlock` set. */
export const CONFIRM_BLOCKED = "CONFIRM_BLOCKED";
