/**
 * Shapes the `buddy` router returns (design 2026-11-18, §13). Dates are ISO strings (this API has no
 * data transformer).
 */
import type { BuddyCallOutcome, BuddyDraftStatus } from "@orrn/db/schema";

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

export type BuddyDraftLine = { label: string; value: string };

export type BuddyDraftView = {
  id: string;
  path: string;
  /** The procedure in plain words (the registry's description, else words from the path). */
  title: string;
  /** The input as a readable list, in the order the model sent it. */
  lines: BuddyDraftLine[];
  status: BuddyDraftStatus;
  createdAt: string;
  expiresAt: string;
  /** The real mutation's result after a confirm, else null. */
  result: unknown;
  failure: string | null;
  /** For an import draft: the web path of the review page (`/ingest/review/<id>` or `/ingest/files/<id>`). */
  link: string | null;
};
