/**
 * Vision read (import portal release 2): the shapes of `ingest.vision.*` as the contract names them
 * (docs/superpowers/plans/2026-11-20-vision-read.md, sections 4, 6 and 7). The web reads PDF pages and photos page by
 * page; a person ticks each model-read table against its page before approval.
 */

import type {
  BlockVisionView,
  VisionNotReadReason as ServerNotReadReason,
  VisionPageState as ServerPageState,
  VisionPageView as ServerPageView,
  VisionStartOut as ServerStartOut,
} from "@orrn/server/lib/ingest/types";

/** The server's lists, copied as values (nothing from the server reaches the bundle); the checks below keep them equal. */
export const VISION_PAGE_STATES = ["waiting", "ready", "read", "not_read", "typed", "skipped"] as const;
export type VisionPageState = (typeof VISION_PAGE_STATES)[number];

export const VISION_NOT_READ_REASONS = [
  "no_table", "refused", "invalid", "too_long", "error", "cap_page", "cap_day_calls", "cap_day_cost", "page_too_large",
  "unsupported_page", "too_many_tables",
] as const;
export type VisionNotReadReason = (typeof VISION_NOT_READ_REASONS)[number];

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const statesMatch: Same<VisionPageState, ServerPageState> = true;
const reasonsMatch: Same<VisionNotReadReason, ServerNotReadReason> = true;
void statesMatch;
void reasonsMatch;

/**
 * Contract section 11.3: a page read in bands carries `bands { total, read }` while banding. Optional here until the
 * server's page view has it.
 */
export type VisionBands = { total: number; read: number };

export type VisionPageView = Omit<ServerPageView, "next"> & {
  /** Section 11.3: "band" when a scan or photo must be cut into bands and read band by band. */
  next: ServerPageView["next"] | "band";
  bands?: VisionBands | null;
};

export type VisionPageTicket = ServerStartOut["uploads"][number];

/**
 * `vision.start`. `texts` (section 11.5): for a text PDF, one ticket per page with no text yet, for
 * `pages/<n>.text.json`; optional here until the server's type has it.
 */
export type VisionStartOut = ServerStartOut & { texts?: VisionPageTicket[] };

export type VisionPagesOut = { pageCount: number; planned: number; pages: VisionPageView[]; settled: boolean };

/**
 * `BlockView.vision`: where a model-read (or typed) block came from. `lowRows` lowest confidence first, then by index.
 * `unseen` (section 11.5): `[row, col]` cells whose digits are not in the PDF's text layer; optional until the server
 * sends it, and missing means no marks.
 */
export type BlockVision = BlockVisionView & { unseen?: [number, number][] };

export type VisionReadUrlIn = { artifactId: string; what: "raw" } | { artifactId: string; what: "page"; page: number };

/** A page is settled once it is read, typed by a person or skipped. */
export function isSettled(state: VisionPageState): boolean {
  return state === "read" || state === "typed" || state === "skipped";
}

/** `IngestStatus.visionReady`: storage and a model client are both there, so PDFs and photos are read page by page. */
export function visionReadyOf(status: unknown): boolean {
  return (status as { visionReady?: unknown } | null | undefined)?.visionReady === true;
}

/** `BlockView.vision`, or null for a block a parser read from a sheet. */
export function blockVisionOf(block: unknown): BlockVision | null {
  const vision = (block as { vision?: unknown } | null | undefined)?.vision;
  return vision && typeof vision === "object" ? (vision as BlockVision) : null;
}
