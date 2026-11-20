/**
 * Vision read (import portal release 2): the shapes of `ingest.vision.*` as the contract names them
 * (docs/superpowers/plans/2026-11-20-vision-read.md, sections 4, 6 and 7). The web reads PDF pages and photos page by
 * page; a person ticks each model-read table against its page before approval.
 */

export const VISION_PAGE_STATES = ["waiting", "ready", "read", "not_read", "typed", "skipped"] as const;
export type VisionPageState = (typeof VISION_PAGE_STATES)[number];

export const VISION_NOT_READ_REASONS = [
  "no_table", "refused", "invalid", "too_long", "error", "cap_page", "cap_day_calls", "cap_day_cost", "page_too_large",
  "unsupported_page", "too_many_tables",
] as const;
export type VisionNotReadReason = (typeof VISION_NOT_READ_REASONS)[number];

export type VisionPageView = {
  page: number;
  state: VisionPageState;
  reason: VisionNotReadReason | null;
  canRetry: boolean;
  next: "retry" | "manual" | "done" | null;
  attempts: number;
  blockIds: string[];
  tables: number;
};

export type VisionPageTicket = { page: number; url: string; ticket: string; expiresAt: number };

export type VisionStartOut = { pageCount: number; planned: number; uploads: VisionPageTicket[] };

export type VisionPagesOut = { pageCount: number; planned: number; pages: VisionPageView[]; settled: boolean };

/** `BlockView.vision`: where a model-read (or typed) block came from. `lowRows` lowest confidence first, then by index. */
export type BlockVision = {
  page: number;
  table: number;
  pageCount: number;
  rowConfidence: number[];
  lowRows: number[];
  typed?: boolean;
};

export type VisionReadUrlIn = { artifactId: string; what: "raw" } | { artifactId: string; what: "page"; page: number };

/** A page is settled once it is read, typed by a person or skipped. */
export function isSettled(state: VisionPageState): boolean {
  return state === "read" || state === "typed" || state === "skipped";
}
