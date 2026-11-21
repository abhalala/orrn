/**
 * Vision read procedures (import portal release 2, contract docs/superpowers/plans/2026-11-20-vision-read.md):
 * a PDF or photo is read page by page. The browser renders each page to a JPEG and PUTs it to the vault
 * with an `ingest-page` ticket from `vision.start`; `vision.readPage` sends one page to the model
 * (`bot/vision.ts`, at most one call) and turns each valid table into a block with `read_by = 'model'`.
 * A page with no usable table is "not read": a person types it (`vision.typePage`) or skips it. Every
 * table then goes through the normal fit, shape helper, dry run and review, and a person ticks "I
 * checked these rows against the page" (`vision.check`) before approval.
 *
 * A page's state is never stored: `derivePage` works it out from the vault listing, the page's run rows
 * (`ingest_bot_run.block_id = visionPageKey`) and the blocks whose `readerFacts.vision.page` is that page.
 * Every procedure answers through it, so the web loops on `next === "retry"` only while the next
 * `readPage` will change what is stored (a model call or a rebuild of blocks from `pages/<n>.tables.json`).
 */
import { fitBlock, headerKey, inferKinds, normalizeHeaders, VISION_PARAMS, visionBandKey, visionOrdinal, visionPageKey } from "@orrn/ingest";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { ingestArtifact, ingestBlock, ingestBotRun, ingestCandidate, ingestStagedRow } from "@orrn/db/schema/ingest";

import { pushChunkedInserts, type SqliteBatchItem } from "../atomic";
import { auditInsert } from "../audit";
import { now } from "../clock";
import { effectiveLimits } from "../effectiveLimits";
import { createId } from "../id";
import { modelCaps } from "../plantLimits";
import { openStagedRows, stagedRowOf } from "./artifacts";
import {
  countCalls,
  historyOutcome,
  planVision,
  runVisionAttempt,
  SONNET,
  shapeBotReady,
  VISION_CLAIM_STALE_MS,
  type BotRunHistoryRow,
  type BotRunRecord,
  type BotRunStore,
  type VisionTable,
} from "./bot";
import { capSample, fitDiffJson, learnedHoles, stateForFit } from "./candidates";
import { guardedBatch, ingestAbortUnlessChanged, isIngestAbort, loadArtifact, MOVED, type ArtifactRow, type StoredVision } from "./core";
import { anthropicEnv, botRunStore } from "./engines";
import { artifactPrefix, bandKey, bandTablesKey, ingestVault, issueReadTicket, issueTicket, pageKey, pagesIndexKey, pageTablesKey, pageTextKey, rawKey, vaultReady } from "./vault";
import {
  INGEST_LIMITS,
  KEPT_UNREAD_NO_STORAGE,
  VISION_ALREADY_READ,
  VISION_FILE_FULL,
  VISION_KINDS_ONLY,
  VISION_NOT_READING,
  VISION_NOT_STORED,
  VISION_PAGE_PAST,
  VISION_PAGE_READ,
  VISION_REBUILD_FAILED,
  VISION_UPLOAD_FIRST,
  KEPT_UNREAD_NOT_READ,
  isVisualKind,
  type IngestCtx,
  type VisionBandTicketsOut,
  type VisionNotReadReason,
  type VisionPagesOut,
  type VisionPageView,
  type VisionReadUrlOut,
  type VisionStartOut,
} from "./types";

// ---------------------------------------------------------------------------
// Page index (contract section 5)
// ---------------------------------------------------------------------------

/**
 * `bands`: page number to the bands it is cut into (contract section 11.3), set once by `vision.bandTickets`.
 * Batches (contract section 12): `planned` is the last page in the plan and grows by `vision.nextBatch`;
 * `batches` lists each planned range `[from, to]` (missing in an index written before batches: read as
 * `[[1, planned]]`). `restNotRead`: a person chose to finish with pages past the plan not read
 * (`vision.finishRest`); `vision.nextBatch` clears it.
 */
export type PagesIndex = {
  v: 1;
  pageCount: number;
  planned: number;
  skipped: number[];
  startedBy: string;
  startedAt: number;
  bands?: Record<string, number>;
  batches?: [number, number][];
  restNotRead?: { by: string; at: number };
};

/** The planned ranges of an index, old ones included. */
export const batchesOf = (index: PagesIndex): [number, number][] => (Array.isArray(index.batches) && index.batches.length > 0 ? index.batches : [[1, index.planned]]);

/** Keys a page may hold under `pages/`: image, text, tables, and up to 4 bands with their tables. */
const KEYS_PER_PAGE = 3 + 2 * VISION_PARAMS.maxBandsPerPage;
/** R2 answers at most 1,000 keys a list call; every listing here asks for that many and follows the cursor. */
export const LIST_LIMIT = 1000;

/**
 * Every key under `prefix`, one list call per 1,000 keys, following the cursor. `maxKeys` bounds the calls
 * (the keys the plan can hold), so a listing never runs away; past it the rest reads as missing.
 */
export async function listKeys(bucket: R2Bucket, prefix: string, maxKeys: number): Promise<Set<string>> {
  const keys = new Set<string>();
  const calls = Math.ceil(Math.max(1, maxKeys) / LIST_LIMIT) + 1;
  let cursor: string | undefined;
  for (let i = 0; i < calls; i++) {
    const listed = await bucket.list({ prefix, limit: LIST_LIMIT, ...(cursor ? { cursor } : {}) });
    for (const o of listed.objects) keys.add(o.key);
    if (!listed.truncated) break;
    cursor = listed.cursor;
  }
  return keys;
}

/** The `pages/` keys of a file: every planned page's keys, or one page's only (`pages/<n>.` and `pages/<n>/`). */
async function pageKeys(bucket: R2Bucket, ctx: Pick<IngestCtx, "companyId">, a: ArtifactRow, planned: number, only?: number): Promise<Set<string>> {
  const prefix = `${artifactPrefix(ctx.companyId, a.sha256)}/pages/`;
  if (only === undefined) return listKeys(bucket, prefix, planned * KEYS_PER_PAGE + 1);
  // The dot and the slash keep page 1 from matching pages 10 to 19.
  const [own, bands] = await Promise.all([listKeys(bucket, `${prefix}${only}.`, 3), listKeys(bucket, `${prefix}${only}/`, 2 * VISION_PARAMS.maxBandsPerPage)]);
  return new Set([...own, ...bands]);
}

/** The bands a page is cut into, or 0 when it is read whole. */
const bandsOf = (index: PagesIndex, page: number): number => {
  const n = index.bands?.[String(page)];
  return Number.isInteger(n) && n! >= 2 && n! <= VISION_PARAMS.maxBandsPerPage ? n! : 0;
};

export type PageTablesFile = { v: 1; runId: string; model: string; tables: VisionTable[] };

async function readJson<T>(bucket: R2Bucket, key: string): Promise<{ body: T; etag: string } | null> {
  const obj = await bucket.get(key);
  if (!obj) return null;
  try {
    return { body: JSON.parse(await obj.text()) as T, etag: obj.etag };
  } catch {
    return null;
  }
}

function validIndex(x: unknown): x is PagesIndex {
  const i = x as PagesIndex;
  return !!i && i.v === 1 && Number.isInteger(i.pageCount) && Number.isInteger(i.planned) && Array.isArray(i.skipped);
}

async function loadIndex(bucket: R2Bucket, ctx: Pick<IngestCtx, "companyId">, a: ArtifactRow): Promise<{ index: PagesIndex; etag: string } | null> {
  const got = await readJson<PagesIndex>(bucket, pagesIndexKey(ctx.companyId, a.sha256));
  return got && validIndex(got.body) ? { index: got.body, etag: got.etag } : null;
}

// ---------------------------------------------------------------------------
// Text-layer digit check (contract section 11.5)
// ---------------------------------------------------------------------------

/** The page text a text PDF page sent (`pages/<n>.text.json`). */
export type PageTextFile = { v: 1; items: string[] };

/** Devanagari (U+0966) and Gujarati (U+0AE6) digits, read as ASCII digits (N16). */
const INDIC_DIGITS = /[\u0966-\u096f\u0ae6-\u0aef]/g;
const asciiDigit = (ch: string) => {
  const c = ch.codePointAt(0)!;
  return String(c - (c >= 0x0ae6 ? 0x0ae6 : 0x0966));
};

/**
 * The digit runs of a string: Devanagari and Gujarati digits read as ASCII digits first, then `\d+` after a
 * comma between two digits is removed (1,23,456 is 123456).
 */
export function digitRuns(s: string): string[] {
  return s.replace(INDIC_DIGITS, asciiDigit).replace(/(?<=\d),(?=\d)/g, "").match(/\d+/g) ?? [];
}

/**
 * The cells (`[row, col]`) holding a digit run that is not a digit run anywhere in the page's text. Each
 * text item is read on its own, so two items never join into one run. Whole runs are matched, never a
 * part of one: "210" is marked against a page that only holds "2100". No text (null) means no marks.
 */
export function unseenCells(rows: readonly (readonly string[])[], items: readonly string[] | null): [number, number][] {
  if (!items) return [];
  const seen = new Set<string>();
  for (const item of items) for (const run of digitRuns(item)) seen.add(run);
  const out: [number, number][] = [];
  rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (digitRuns(cell).some((run) => !seen.has(run))) out.push([r, c]);
    }),
  );
  return out;
}

/** The text items of a text PDF page, or null when the file is not a text PDF or the text is missing or not valid. */
async function loadPageText(bucket: R2Bucket, ctx: Pick<IngestCtx, "companyId">, a: ArtifactRow, page: number): Promise<string[] | null> {
  if (a.kind !== "pdf_text") return null;
  const got = await readJson<PageTextFile>(bucket, pageTextKey(ctx.companyId, a.sha256, page));
  const body = got?.body;
  if (!body || body.v !== 1 || !Array.isArray(body.items) || !body.items.every((x) => typeof x === "string")) return null;
  return body.items;
}

// ---------------------------------------------------------------------------
// Bands (contract section 11.3)
// ---------------------------------------------------------------------------

/**
 * The banded table of band 1's answer: the table with the most rows, the last one on a tie. The dense
 * table runs off the bottom of band 1, so it holds most of band 1's rows; the prompt does not promise an
 * order of tables, so the rule does not depend on one.
 */
export function bandedTableIndex(tables: readonly VisionTable[]): number {
  let best = 0;
  tables.forEach((t, i) => {
    if (t.rows.length >= tables[best]!.rows.length) best = i;
  });
  return best;
}

const headerLine = (cells: readonly string[]) => cells.map((c) => c.trim().replace(/\s+/g, " ").toLowerCase()).join("\u0000");

/**
 * Merge the bands of one page (pure). `first` is band 1's answer; `rest` is the answer of bands 2..K in
 * order. The banded table of band 1 takes the rows of every later band in order; a first row of band
 * k >= 2 that equals the headers (the header strip read as data) is dropped, once; nothing else is
 * de-duplicated, since the cuts have no overlap. Band 1's other tables stay as they are, in place. A later
 * band with no table (a footer or signature strip, S4) adds no rows. Null when band 1 has no table, a later
 * band holds more than one table, or any row is not as wide as the headers.
 */
export function mergeBands(first: readonly VisionTable[], rest: readonly (readonly VisionTable[])[]): { tables: VisionTable[]; banded: number } | null {
  if (first.length === 0) return null;
  const banded = bandedTableIndex(first);
  const base = first[banded]!;
  const width = base.headers.length;
  if (base.rows.some((r) => r.length !== width)) return null;
  const head = headerLine(base.headers);
  const rows = [...base.rows];
  const rowConfidence = [...base.rowConfidence];
  for (const answer of rest) {
    if (answer.length === 0) continue;
    if (answer.length !== 1) return null;
    const t = answer[0]!;
    if (t.headers.length !== width || t.rows.some((r) => r.length !== width)) return null;
    const start = t.rows.length > 0 && headerLine(t.rows[0]!) === head ? 1 : 0;
    rows.push(...t.rows.slice(start));
    rowConfidence.push(...t.rows.slice(start).map((_, i) => t.rowConfidence[start + i] ?? 0));
  }
  const lowConfidenceRows = rowConfidence
    .map((c, i) => ({ c, i }))
    .filter((x) => x.c < VISION_PARAMS.lowConfidence)
    .sort((x, y) => x.c - y.c || x.i - y.i)
    .map((x) => x.i);
  const merged: VisionTable = { title: base.title, headers: [...base.headers], rows, rowConfidence, lowConfidenceRows };
  return { tables: first.map((t, i) => (i === banded ? merged : t)), banded };
}

// ---------------------------------------------------------------------------
// Page state (contract section 4)
// ---------------------------------------------------------------------------

/** `short`: a model block whose staged rows stop before its row count (a batch after the first one stopped, S5). */
export type PageBlock = { id: string; readBy: "parser" | "model"; typed: boolean; tables: number; short?: boolean };

/** One band of a page cut into bands: its image, its tables object and its run rows (`visionBandKey`). */
export type BandItemFacts = { hasImage: boolean; hasTables: boolean; history: readonly BotRunHistoryRow[]; inFlight?: boolean };

/** A page cut into bands. `band1Tables`: tables in band 1's tables object, when it was read. */
export type BandFacts = { total: number; items: readonly BandItemFacts[]; band1Tables: number | null };

/** Everything the state of one page is derived from. */
export type PageFacts = {
  page: number;
  hasImage: boolean;
  /** `pages/<n>.tables.json` exists. */
  hasTables: boolean;
  /** Tables in that object, when it was read; null when not needed or absent. */
  tablesInFile: number | null;
  /** The page's run rows, oldest first, `capped` included. */
  history: readonly BotRunHistoryRow[];
  /** Blocks whose `readerFacts.vision.page` is this page. */
  blocks: readonly PageBlock[];
  skipped: boolean;
  /** Blocks of the whole file. */
  fileBlocks: number;
  /** A scan or photo: a dense or cut-off whole-page read goes to bands (section 11.3). A text PDF never does. */
  bandable?: boolean;
  /** The table of the tables object with the most rows, when the object was read. */
  largest?: { rows: number; headers: string[] } | null;
  /** The page is cut into bands: the whole-page tables object and run rows no longer count. */
  band?: BandFacts | null;
  /** A live claim (`pending`, younger than `VISION_CLAIM_STALE_MS`) holds the page key: a call is in flight. */
  inFlight?: boolean;
};

const CAP_REASON: Record<string, VisionNotReadReason> = {
  "cap:block_calls": "cap_page",
  "cap:day_calls": "cap_day_calls",
  "cap:day_cost": "cap_day_cost",
};

type PlanView = Pick<VisionPageView, "state" | "reason" | "canRetry" | "next">;

const lastCall = (history: readonly BotRunHistoryRow[]) => history.filter((h) => h.outcome !== "capped").at(-1);

/** A band is read when its last call was a recipe and its tables reached the vault. */
const bandRead = (b: BandItemFacts) => b.hasTables && lastCall(b.history)?.outcome === "recipe";

/**
 * The plan of one run key (the whole page or one band) with no stored tables of a recipe run: waiting
 * for the image, the next call, or not read with its reason.
 */
function planKey(history: readonly BotRunHistoryRow[], hasImage: boolean, hasTables: boolean, room: number): PlanView {
  const notRead = (reason: VisionNotReadReason, canRetry = false): PlanView => ({ state: "not_read", reason, canRetry, next: "manual" });
  if (!hasImage) return { state: "waiting", reason: null, canRetry: false, next: null };
  if (room <= 0) return notRead("too_many_tables");
  const calls = history.filter((h) => h.outcome !== "capped");
  // A recipe run whose tables never reached the vault is not a done read; it counts as an error.
  const orphan = calls.at(-1)?.outcome === "recipe" && !hasTables;
  const seen = orphanHistory(history, orphan);
  const last = history.at(-1);
  if (last?.outcome === "capped") {
    // N11: a page at its own call cap stays capped on any day (the key's history has no day window), so
    // only a day cap may be read again.
    const reason = CAP_REASON[(last.errorCodes ?? [])[0] ?? ""] ?? "cap_day_calls";
    return notRead(reason, reason !== "cap_page");
  }
  const plan = planVision(seen, SONNET);
  if (plan.next === "retry" || plan.next === "escalate") {
    if (orphan) return notRead("error", true);
    return { state: "ready", reason: null, canRetry: false, next: calls.length === 0 ? null : "retry" };
  }
  const real = seen.filter((h) => h.outcome !== "capped");
  const end = real.at(-1);
  if (!end) return notRead("error");
  if (end.outcome === "no_target") return notRead("no_table");
  if (end.outcome === "refused") return notRead("refused");
  if (end.outcome === "invalid") {
    const invalid = real.filter((h) => h.outcome === "invalid").slice(-2);
    const truncated = invalid.length === 2 && invalid.every((h) => (h.errorCodes ?? []).includes("output:truncated"));
    return notRead(truncated ? "too_long" : "invalid");
  }
  return notRead("error");
}

/**
 * The view of one page (pure). Settled first (typed, all tables read, skipped), then the run plan.
 * `next: "retry"` comes back only when the next `readPage` makes a call or builds blocks; a file with
 * no room for the page's tables, and a `recipe` run whose tables never reached the vault, are manual.
 * A page cut into bands reads band by band in order and builds its blocks when every band is read.
 */
export function derivePage(f: PageFacts): VisionPageView {
  const band = f.band ?? null;
  const attempts = countCalls([...f.history, ...(band?.items.flatMap((b) => b.history) ?? [])]);
  const blockIds = f.blocks.map((b) => b.id);
  const firstUnread = band ? band.items.findIndex((b) => !bandRead(b)) : -1;
  const bands = band ? { total: band.total, read: band.items.filter(bandRead).length, next: firstUnread >= 0 ? firstUnread + 1 : null } : null;
  const view = (v: PlanView & { tables?: number; bandHeaders?: string[] | null }): VisionPageView => ({
    page: f.page,
    attempts,
    blockIds,
    tables: v.tables ?? f.blocks.length,
    state: v.state,
    reason: v.reason,
    canRetry: v.canRetry,
    next: v.next,
    bands,
    bandHeaders: v.bandHeaders ?? null,
  });
  const notRead = (reason: VisionNotReadReason, canRetry = false) => view({ state: "not_read", reason, canRetry, next: "manual" });

  if (f.blocks.some((b) => b.typed)) return view({ state: "typed", reason: null, canRetry: false, next: "done" });
  const model = f.blocks.filter((b) => b.readBy === "model");
  const expected = Math.max(0, ...model.map((b) => b.tables));
  const short = model.some((b) => b.short);
  if (model.length > 0 && model.length >= expected && !short) return view({ state: "read", reason: null, canRetry: false, next: "done" });
  if (f.skipped) return view({ state: "skipped", reason: null, canRetry: false, next: "done" });

  const room = INGEST_LIMITS.blocksPerFile - f.fileBlocks;
  // Another tab's call is in flight on this page or its next band: nothing to do now (no call, no retry loop).
  const busy = view({ state: "ready", reason: null, canRetry: false, next: null, tables: 0 });
  if (band) {
    if (bands!.next !== null && band.items[bands!.next - 1]!.inFlight) return busy;
    const n = band.band1Tables ?? expected;
    if (model.length > 0) {
      // Part of the page's tables are blocks: the rest are built again from the bands' tables objects.
      if (bands!.next !== null) return notRead("error");
      if (n - model.length > room) return notRead("too_many_tables");
      // S2: the bands hold no table that is not a block yet, so a rebuild could add nothing.
      if (band.band1Tables !== null && n <= model.length && !short) return notRead("error");
      return view({ state: "ready", reason: null, canRetry: false, next: "retry", tables: n });
    }
    if (bands!.next === null) {
      // Every band is read: the next readPage merges them and builds the blocks, with no call.
      if (n > room) return notRead("too_many_tables");
      return view({ state: "ready", reason: null, canRetry: false, next: "retry", tables: n });
    }
    const b = band.items[bands!.next - 1]!;
    const plan = planKey(b.history, b.hasImage, b.hasTables, room);
    // Band 2..K waits for nothing but its image once band 1 is read: it is the next call.
    const next = plan.state === "ready" && bands!.read > 0 ? "retry" : plan.next;
    return view({ ...plan, next, tables: band.band1Tables ?? 0 });
  }

  if (f.inFlight && model.length === 0) return busy;
  if (model.length > 0) {
    // Part of the page's tables are blocks: the rest are rebuilt from the tables object.
    const missing = (f.tablesInFile ?? expected) - model.length;
    if (!f.hasTables) return notRead("error");
    // S2: the tables object holds no table that is not a block yet, so a rebuild could add nothing.
    if (f.tablesInFile !== null && missing <= 0 && !short) return notRead("error");
    if (missing > room) return notRead("too_many_tables");
    return view({ state: "ready", reason: null, canRetry: false, next: "retry", tables: f.tablesInFile ?? expected });
  }

  const lastReal = lastCall(f.history);
  if (lastReal?.outcome === "recipe" && f.hasTables) {
    const n = f.tablesInFile ?? 0;
    // A scan or photo with a table past the threshold is read again in bands (section 11.3).
    if (f.bandable && (f.largest?.rows ?? 0) > VISION_PARAMS.bandRowThreshold) {
      return view({ state: "ready", reason: null, canRetry: false, next: "band", tables: n, bandHeaders: f.largest!.headers });
    }
    if (n > room) return notRead("too_many_tables");
    return view({ state: "ready", reason: null, canRetry: false, next: "retry", tables: n });
  }
  // A scan or photo whose whole-page answer was cut off is read in bands instead of again whole.
  if (f.bandable && f.hasImage && lastReal?.outcome === "invalid" && (lastReal.errorCodes ?? []).includes("output:truncated") && f.history.at(-1)?.outcome !== "capped") {
    return view({ state: "ready", reason: null, canRetry: false, next: "band", tables: 0, bandHeaders: null });
  }
  return view({ ...planKey(f.history, f.hasImage, f.hasTables, room), tables: 0 });
}

/** The history the planner sees when a recipe run's tables never reached the vault: those runs are errors. */
function orphanHistory(history: readonly BotRunHistoryRow[], orphan: boolean): BotRunHistoryRow[] {
  return orphan ? history.map((h) => (h.outcome === "recipe" ? { ...h, outcome: "error" as const } : h)) : [...history];
}

export const isSettled = (v: VisionPageView) => v.state === "read" || v.state === "typed" || v.state === "skipped";

type FileFacts = {
  index: PagesIndex;
  etag: string;
  pages: VisionPageView[];
  facts: PageFacts[];
  blockRows: { id: string; ordinal: number; readBy: "parser" | "model"; vision: StoredVision | null; short: boolean }[];
};

/** Reads the facts of every planned page (or only `only`): one listing, one runs query, one blocks query. */
async function loadFacts(ctx: IngestCtx, bucket: R2Bucket, a: ArtifactRow, index: { index: PagesIndex; etag: string }, only?: number): Promise<FileFacts> {
  const planned = index.index.planned;
  const pages = only !== undefined ? [only] : Array.from({ length: planned }, (_, i) => i + 1);
  const keys = await pageKeys(bucket, ctx, a, planned, only);
  type RunRow = { blockId: string; attempt: number; model: string; outcome: string; errorCodes: string[] | null; createdAt: Date };
  const cols = { blockId: ingestBotRun.blockId, attempt: ingestBotRun.attempt, model: ingestBotRun.model, outcome: ingestBotRun.outcome, errorCodes: ingestBotRun.errorCodes, createdAt: ingestBotRun.createdAt };
  // One page: its page key and band keys (at most 5, one IN list). The whole file: every run key of the
  // artifact (`<id>:p...`) by one range on `block_id`, which the block index serves at any page count.
  const keyFilter =
    only !== undefined
      ? inArray(ingestBotRun.blockId, [visionPageKey(a.id, only), ...Array.from({ length: bandsOf(index.index, only) }, (_, k) => visionBandKey(a.id, only, k + 1))])
      : and(sql`${ingestBotRun.blockId} >= ${`${a.id}:p`}`, sql`${ingestBotRun.blockId} < ${`${a.id}:q`}`);
  const runs = (await ctx.db
    .select(cols)
    .from(ingestBotRun)
    .where(and(eq(ingestBotRun.companyId, ctx.companyId), eq(ingestBotRun.purpose, "vision"), keyFilter))
    .orderBy(asc(ingestBotRun.createdAt), asc(ingestBotRun.attempt))) as RunRow[];
  const byKey = new Map<string, BotRunHistoryRow[]>();
  const live = new Set<string>();
  const staleBefore = now().getTime() - VISION_CLAIM_STALE_MS;
  for (const r of runs) {
    const list = byKey.get(r.blockId) ?? [];
    list.push({ attempt: r.attempt, model: r.model, outcome: historyOutcome(r.outcome as never), errorCodes: r.errorCodes });
    byKey.set(r.blockId, list);
    if (r.outcome === "pending" && r.createdAt.getTime() > staleBefore) live.add(r.blockId);
  }
  const historyOf = (key: string): BotRunHistoryRow[] => byKey.get(key) ?? [];
  const blocks = await ctx.db
    .select({ id: ingestBlock.id, ordinal: ingestBlock.ordinal, readBy: ingestBlock.readBy, readerFacts: ingestBlock.readerFacts, rowsPut: ingestBlock.rowsPut, rowCount: ingestBlock.rowCount })
    .from(ingestBlock)
    .where(and(eq(ingestBlock.companyId, ctx.companyId), eq(ingestBlock.artifactId, a.id)))
    .orderBy(asc(ingestBlock.ordinal));
  const blockRows = blocks.map((b) => ({ id: b.id, ordinal: b.ordinal, readBy: b.readBy, vision: b.readerFacts?.vision ?? null, short: b.readBy === "model" && b.rowsPut < b.rowCount }));
  const skipped = new Set(index.index.skipped);
  const facts: PageFacts[] = [];
  for (const p of pages) {
    const history = historyOf(visionPageKey(a.id, p));
    const total = bandsOf(index.index, p);
    const band: BandFacts | null = total
      ? {
          total,
          items: Array.from({ length: total }, (_, k) => ({
            hasImage: keys.has(bandKey(ctx.companyId, a.sha256, p, k + 1)),
            hasTables: keys.has(bandTablesKey(ctx.companyId, a.sha256, p, k + 1)),
            history: historyOf(visionBandKey(a.id, p, k + 1)),
            inFlight: live.has(visionBandKey(a.id, p, k + 1)),
          })),
          band1Tables: null,
        }
      : null;
    const onPage = blockRows
      .filter((b) => b.vision?.page === p)
      .map((b) => ({ id: b.id, readBy: b.readBy, typed: b.vision?.typed === true, tables: b.vision?.tables ?? 1, short: b.short }));
    const hasTables = keys.has(pageTablesKey(ctx.companyId, a.sha256, p));
    const f: PageFacts = {
      page: p,
      hasImage: keys.has(pageKey(ctx.companyId, a.sha256, p)),
      hasTables,
      tablesInFile: null,
      history,
      blocks: onPage,
      skipped: skipped.has(p),
      // The stored count moves with every block written (and is what the write guard checks).
      fileBlocks: Math.max(blocks.length, a.blockCount ?? 0),
      bandable: a.kind !== "pdf_text",
      largest: null,
      band,
      inFlight: live.has(visionPageKey(a.id, p)),
    };
    // A tables object is read only for a page whose blocks are not all there yet (rare).
    if (band) {
      if (band.items[0]!.hasTables && !isSettled(derivePage(f))) {
        const got = await readJson<PageTablesFile>(bucket, bandTablesKey(ctx.companyId, a.sha256, p, 1));
        if (got && Array.isArray(got.body?.tables)) band.band1Tables = got.body.tables.length;
        else f.band = { ...band, items: band.items.map((b, k) => (k === 0 ? { ...b, hasTables: false } : b)) };
      }
    } else if (hasTables && !isSettled(derivePage(f))) {
      const got = await readJson<PageTablesFile>(bucket, pageTablesKey(ctx.companyId, a.sha256, p));
      // An object that cannot be read is as good as none: the page is not rebuilt from it.
      if (got && Array.isArray(got.body?.tables)) {
        f.tablesInFile = got.body.tables.length;
        const big = got.body.tables[bandedTableIndex(got.body.tables)];
        f.largest = big ? { rows: big.rows.length, headers: big.headers } : null;
      } else f.hasTables = false;
    }
    facts.push(f);
  }
  return { index: index.index, etag: index.etag, facts, pages: facts.map(derivePage), blockRows };
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function needVault(): R2Bucket {
  const bucket = ingestVault();
  if (!bucket || !vaultReady()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: KEPT_UNREAD_NO_STORAGE });
  return bucket;
}

async function readingFile(ctx: IngestCtx, artifactId: string): Promise<{ a: ArtifactRow; bucket: R2Bucket; index: { index: PagesIndex; etag: string } }> {
  const a = await loadArtifact(ctx, artifactId);
  if (!isVisualKind(a.kind)) throw new TRPCError({ code: "BAD_REQUEST", message: VISION_KINDS_ONLY });
  const bucket = needVault();
  if (a.readState !== "reading") throw new TRPCError({ code: "BAD_REQUEST", message: VISION_NOT_READING });
  const index = await loadIndex(bucket, ctx, a);
  if (!index) throw new TRPCError({ code: "BAD_REQUEST", message: VISION_NOT_READING });
  return { a, bucket, index };
}

function plannedPage(index: PagesIndex, page: number): void {
  if (page < 1 || page > index.planned) throw new TRPCError({ code: "BAD_REQUEST", message: VISION_PAGE_PAST });
}

// ---------------------------------------------------------------------------
// start / pages
// ---------------------------------------------------------------------------

export async function visionStart(ctx: IngestCtx, input: { artifactId: string; pageCount: number }): Promise<VisionStartOut> {
  const a = await loadArtifact(ctx, input.artifactId);
  if (!isVisualKind(a.kind)) throw new TRPCError({ code: "BAD_REQUEST", message: VISION_KINDS_ONLY });
  const bucket = ingestVault();
  if (!bucket || !vaultReady()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: KEPT_UNREAD_NO_STORAGE });
  if (!shapeBotReady(anthropicEnv())) throw new TRPCError({ code: "PRECONDITION_FAILED", message: KEPT_UNREAD_NOT_READ });
  if (a.vaultState !== "stored") throw new TRPCError({ code: "PRECONDITION_FAILED", message: VISION_NOT_STORED });
  if (a.readState !== "kept_unread" && a.readState !== "reading") throw new TRPCError({ code: "BAD_REQUEST", message: VISION_ALREADY_READ });

  // The plan is written once; a second start (another tab, a reload) resumes it as it is.
  let index = await loadIndex(bucket, ctx, a);
  if (!index) {
    const body: PagesIndex = {
      v: 1,
      pageCount: input.pageCount,
      // The plant's pages per batch (`effectiveLimits`, set in Godseye). A plan already written keeps its own.
      planned: Math.min(input.pageCount, (await effectiveLimits(ctx)).visionPagesPerBatch),
      skipped: [],
      startedBy: ctx.session.user.id,
      startedAt: now().getTime(),
    };
    body.batches = [[1, body.planned]];
    // Written only when absent: two first starts at once write one plan, and the slower one answers it.
    const put = await bucket.put(pagesIndexKey(ctx.companyId, a.sha256), JSON.stringify(body), {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json" },
      customMetadata: { companyId: ctx.companyId, artifactId: a.id },
    });
    index = put ? { index: body, etag: put.etag } : await loadIndex(bucket, ctx, a);
    if (!index) throw new TRPCError(MOVED);
  }
  if (a.readState === "kept_unread") {
    await guardedBatch(
      ctx.db,
      [
        ctx.db
          .update(ingestArtifact)
          .set({ readState: "reading", readError: null, updatedAt: now() })
          .where(and(eq(ingestArtifact.id, a.id), eq(ingestArtifact.companyId, ctx.companyId), eq(ingestArtifact.readState, "kept_unread"))),
        ingestAbortUnlessChanged(ctx.db),
        auditInsert(ctx, {
          action: "ingest.vision.start",
          subjectType: "ingest_artifact",
          subjectId: a.id,
          meta: { fileName: a.fileName, kind: a.kind, pageCount: index.index.pageCount, planned: index.index.planned },
        }),
      ],
      MOVED,
    ).catch(async (e) => {
      // Another tab started it first: that is the same plan.
      if ((await loadArtifact(ctx, a.id)).readState !== "reading") throw e;
    });
  }
  return planTickets(ctx, a, index.index, await pageKeys(bucket, ctx, a, index.index.planned), 1, index.index.planned);
}

/**
 * Upload tickets for pages `from` to `to` with no image yet (a page cut into bands sends its bands
 * through `vision.bandTickets`), and for a text PDF the page text tickets (contract section 11.5).
 */
async function planTickets(ctx: IngestCtx, a: ArtifactRow, index: PagesIndex, have: Set<string>, from: number, to: number): Promise<VisionStartOut> {
  const ticket = (key: string, size: number, contentType: string, fileName: string) =>
    issueTicket(ctx, { purpose: "ingest-page", companyId: ctx.companyId, userId: ctx.session.user.id, artifactId: a.id, sha256: a.sha256, key, size, exactSize: false, contentType, fileName });
  const uploads: VisionStartOut["uploads"] = [];
  const texts: VisionStartOut["texts"] = [];
  for (let p = from; p <= to; p++) {
    const key = pageKey(ctx.companyId, a.sha256, p);
    if (!have.has(key) && bandsOf(index, p) === 0) {
      const t = await ticket(key, VISION_PARAMS.maxPageBytes, VISION_PARAMS.pageContentType, `${p}.jpg`);
      uploads.push({ page: p, url: t.url, ticket: t.ticket, expiresAt: t.expiresAt });
    }
    const textKey = pageTextKey(ctx.companyId, a.sha256, p);
    if (a.kind === "pdf_text" && !have.has(textKey)) {
      const t = await ticket(textKey, VISION_PARAMS.maxPageTextBytes, "application/json", `${p}.text.json`);
      texts.push({ page: p, url: t.url, ticket: t.ticket, expiresAt: t.expiresAt });
    }
  }
  return { pageCount: index.pageCount, planned: index.planned, uploads, texts };
}

// ---------------------------------------------------------------------------
// Batches (contract section 12)
// ---------------------------------------------------------------------------

/**
 * A page the model can still take today or later: no image yet, an answer or rebuild due, or stopped
 * by a day cap. A page only a person can settle (typed or skipped: manual reasons, `cap_page`, a page
 * waiting to be cut) never holds the next batch back.
 */
export function openForModel(v: VisionPageView): boolean {
  if (isSettled(v)) return false;
  if (v.state === "waiting") return v.next !== "band";
  if (v.state === "ready") return v.next !== "band";
  return v.state === "not_read" && (v.reason === "cap_day_calls" || v.reason === "cap_day_cost");
}

const isFull = (a: ArtifactRow, facts: FileFacts) => Math.max(a.blockCount ?? 0, facts.blockRows.length) >= INGEST_LIMITS.blocksPerFile;

/**
 * "Read next pages": plans pages `planned + 1` to `planned + visionPagesPerBatch` (the plant's value now)
 * and hands their tickets. While the plan still holds a page the model can take, nothing is planned and
 * the missing tickets of the plan come back instead, so a second click or a second tab plans nothing
 * twice. A file holding `blocksPerFile` tables is refused in plain words. Clears `restNotRead`.
 */
export async function visionNextBatch(ctx: IngestCtx, input: { artifactId: string }): Promise<VisionStartOut> {
  const { a, bucket, index } = await readingFile(ctx, input.artifactId);
  if (!shapeBotReady(anthropicEnv())) throw new TRPCError({ code: "PRECONDITION_FAILED", message: KEPT_UNREAD_NOT_READ });
  const facts = await loadFacts(ctx, bucket, a, index);
  const have = await pageKeys(bucket, ctx, a, index.index.planned);
  if (facts.pages.some(openForModel) || index.index.planned >= index.index.pageCount) {
    return planTickets(ctx, a, index.index, have, 1, index.index.planned);
  }
  if (isFull(a, facts)) throw new TRPCError({ code: "BAD_REQUEST", message: VISION_FILE_FULL });
  const from = index.index.planned + 1;
  const to = Math.min(index.index.pageCount, index.index.planned + (await effectiveLimits(ctx)).visionPagesPerBatch);
  const body: PagesIndex = { ...index.index, planned: to, batches: [...batchesOf(index.index), [from, to]] };
  delete body.restNotRead;
  const put = await bucket.put(pagesIndexKey(ctx.companyId, a.sha256), JSON.stringify(body), {
    onlyIf: { etagMatches: index.etag },
    httpMetadata: { contentType: "application/json" },
    customMetadata: { companyId: ctx.companyId, artifactId: a.id },
  });
  // Another tab planned or changed the plan in between: its plan stands.
  if (!put) throw new TRPCError(MOVED);
  await guardedBatch(ctx.db, [
    auditInsert(ctx, { action: "ingest.vision.batch", subjectType: "ingest_artifact", subjectId: a.id, meta: { from, to, pageCount: body.pageCount } }),
  ]);
  return planTickets(ctx, a, body, have, from, to);
}

/**
 * "Finish" with pages left: every planned page not yet read, typed or skipped is skipped, and pages past
 * the plan are marked not read, in one write of the plan. `artifact.complete` then goes through. Used
 * when a person stops after a batch, and when the file is full.
 */
export async function visionFinishRest(ctx: IngestCtx, input: { artifactId: string }): Promise<VisionPagesOut> {
  const { a, bucket, index } = await readingFile(ctx, input.artifactId);
  const facts = await loadFacts(ctx, bucket, a, index);
  const open = facts.pages.filter((v) => !isSettled(v)).map((v) => v.page);
  const past = index.index.planned < index.index.pageCount;
  if (open.length > 0 || (past && !index.index.restNotRead)) {
    const body: PagesIndex = {
      ...index.index,
      skipped: [...new Set([...index.index.skipped, ...open])].sort((x, y) => x - y),
      ...(past ? { restNotRead: { by: ctx.session.user.id, at: now().getTime() } } : {}),
    };
    const put = await bucket.put(pagesIndexKey(ctx.companyId, a.sha256), JSON.stringify(body), {
      onlyIf: { etagMatches: index.etag },
      httpMetadata: { contentType: "application/json" },
      customMetadata: { companyId: ctx.companyId, artifactId: a.id },
    });
    if (!put) throw new TRPCError(MOVED);
    await guardedBatch(ctx.db, [
      auditInsert(ctx, {
        action: "ingest.vision.rest",
        subjectType: "ingest_artifact",
        subjectId: a.id,
        meta: { skipped: open, notRead: past ? [index.index.planned + 1, index.index.pageCount] : null },
      }),
    ]);
  }
  return visionPages(ctx, input);
}

/** Every planned page with its state. A file not started yet (kept, or read before release 2) has no pages. */
export async function visionPages(ctx: IngestCtx, input: { artifactId: string }): Promise<VisionPagesOut> {
  const a = await loadArtifact(ctx, input.artifactId);
  if (!isVisualKind(a.kind)) throw new TRPCError({ code: "BAD_REQUEST", message: VISION_KINDS_ONLY });
  const bucket = ingestVault();
  const index = bucket ? await loadIndex(bucket, ctx, a) : null;
  if (!bucket || !index) return { pageCount: 0, planned: 0, pages: [], settled: false, full: false, restNotRead: false, canFinish: false };
  const f = await loadFacts(ctx, bucket, a, index);
  const settled = f.pages.every(isSettled);
  const restNotRead = Boolean(f.index.restNotRead);
  return { pageCount: f.index.pageCount, planned: f.index.planned, pages: f.pages, settled, full: isFull(a, f), restNotRead, canFinish: settled && canEnd(f.index) };
}

/** Pages past the plan do not hold the file open only when there are none or a person left them not read. */
const canEnd = (index: PagesIndex) => index.planned >= index.pageCount || Boolean(index.restNotRead);

/** Contract section 4: whether every planned page of a visual file is read, typed or skipped. */
export async function visionAllSettled(ctx: IngestCtx, a: ArtifactRow): Promise<boolean> {
  const bucket = ingestVault();
  const index = bucket ? await loadIndex(bucket, ctx, a) : null;
  if (!bucket || !index) return false;
  // Batches (section 12): pages past the plan are read by "Read next pages" or left by `vision.finishRest`.
  if (!canEnd(index.index)) return false;
  return (await loadFacts(ctx, bucket, a, index)).pages.every(isSettled);
}

// ---------------------------------------------------------------------------
// readPage
// ---------------------------------------------------------------------------

/**
 * The run store of a page or band read: a page's recipe runs are seen as errors when their tables never
 * reached the vault, and `claimRun` writes the `pending` claim in one statement that finds no live claim
 * of the same key (AGENTS section 2: the guard is in the statement's own WHERE), so two tabs never both
 * call for one page or band.
 */
function visionStore(ctx: IngestCtx, orphan: boolean): BotRunStore {
  const base = botRunStore(ctx);
  return {
    ...base,
    ...(orphan ? { listBlockRuns: async (args: Parameters<BotRunStore["listBlockRuns"]>[0]) => orphanHistory(await base.listBlockRuns(args), true) } : {}),
    claimRun: (row, staleMs) => claimVisionRun(ctx, row, staleMs),
  };
}

async function claimVisionRun(ctx: IngestCtx, row: BotRunRecord, staleMs: number): Promise<string | null> {
  const id = createId();
  await ctx.db.run(sql`
    insert into ingest_bot_run (id, company_id, block_id, candidate_id, purpose, model, attempt, outcome, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micro_usd, duration_ms, error_codes, created_by, created_at)
    select ${id}, ${ctx.companyId}, ${row.blockId}, null, 'vision', ${row.model}, ${row.attempt}, 'pending', 0, 0, 0, 0, ${row.costMicroUsd}, 0, null, ${row.createdBy}, ${row.createdAtMs}
    where not exists (
      select 1 from ingest_bot_run r
      where r.company_id = ${ctx.companyId} and r.block_id = ${row.blockId} and r.purpose = 'vision' and r.outcome = 'pending' and r.created_at > ${row.createdAtMs - staleMs}
    )`);
  const [got] = await ctx.db.select({ id: ingestBotRun.id }).from(ingestBotRun).where(and(eq(ingestBotRun.id, id), eq(ingestBotRun.companyId, ctx.companyId))).limit(1);
  return got ? id : null;
}

/**
 * Writes a tables object only when the key holds none (an earlier answer whose run never finished keeps
 * its place), and answers the tables the key holds after the write.
 */
async function putTablesOnce(bucket: R2Bucket, key: string, file: PageTablesFile, a: ArtifactRow, companyId: string): Promise<VisionTable[]> {
  const put = await bucket.put(key, JSON.stringify(file), {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/json" },
    customMetadata: { companyId, artifactId: a.id },
  });
  if (put) return file.tables;
  const got = await readJson<PageTablesFile>(bucket, key);
  if (!got || !Array.isArray(got.body?.tables)) throw new Error("tables object unreadable");
  return got.body.tables;
}

export async function visionReadPage(ctx: IngestCtx, input: { artifactId: string; page: number; band?: number }): Promise<VisionPageView> {
  const { a, bucket, index } = await readingFile(ctx, input.artifactId);
  plannedPage(index.index, input.page);
  const facts = await loadFacts(ctx, bucket, a, index, input.page);
  const f = facts.facts[0]!;
  const view = facts.pages[0]!;
  if (isSettled(view)) return view;
  if (f.band) return readBand(ctx, a, bucket, index.index, f, f.band, view, input);
  if (f.inFlight) return view;
  // A band of a page that is not cut into bands, or a page that waits for its bands: no call.
  if (input.band !== undefined || view.next === "band") return view;
  if (view.state === "waiting") throw new TRPCError({ code: "BAD_REQUEST", message: VISION_UPLOAD_FIRST });
  if (view.state === "not_read" && !view.canRetry) return view;
  // S3: a file or plant already at its row limit is refused before the model is paid for the page.
  await assertRowRoom(ctx, a, 0);

  // A rebuild: the tables are in the vault but not all of them are blocks yet. No model call.
  if (view.state === "ready" && f.hasTables && (f.blocks.length > 0 || f.history.filter((h) => h.outcome !== "capped").at(-1)?.outcome === "recipe")) {
    const got = await readJson<PageTablesFile>(bucket, pageTablesKey(ctx.companyId, a.sha256, input.page));
    if (got && Array.isArray(got.body.tables)) {
      const wrote = await insertTables(ctx, a, input.page, index.index.pageCount, got.body.tables);
      return afterRebuild(ctx, input, wrote);
    }
  }

  const obj = await bucket.get(pageKey(ctx.companyId, a.sha256, input.page));
  if (!obj) throw new TRPCError({ code: "BAD_REQUEST", message: VISION_UPLOAD_FIRST });
  const bytes = new Uint8Array(await obj.arrayBuffer());
  const mediaType = (obj.httpMetadata?.contentType ?? VISION_PARAMS.pageContentType) as "image/jpeg";
  const lastReal = f.history.filter((h) => h.outcome !== "capped").at(-1);
  const tablesKey = pageTablesKey(ctx.companyId, a.sha256, input.page);
  let stored: VisionTable[] | null = null;
  const result = await runVisionAttempt({
    env: anthropicEnv(),
    store: visionStore(ctx, lastReal?.outcome === "recipe" && !f.hasTables),
    // The tables go to the vault before the run is finished, so a batch that fails is rebuilt with no new call.
    onTables: async (tables, runId, model) => {
      stored = await putTablesOnce(bucket, tablesKey, { v: 1, runId, model, tables }, a, ctx.companyId);
    },
    caps: modelCaps(await effectiveLimits(ctx)),
    companyId: ctx.companyId,
    userId: ctx.session.user.id,
    blockId: visionPageKey(a.id, input.page),
    pageKind: a.kind === "image" ? "image" : "pdf_scan",
    page: { mediaType, bytes },
    vaultReady: true,
    visualReads: true,
    nowMs: () => now().getTime(),
  });
  if (result.status === "skipped") {
    if (result.reason === "page_too_large" || result.reason === "unsupported_page") {
      return { ...view, state: "not_read", reason: result.reason, canRetry: false, next: "manual" };
    }
    if (result.reason === "no_key" || result.reason === "vault_required") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: result.reason === "no_key" ? KEPT_UNREAD_NOT_READ : KEPT_UNREAD_NO_STORAGE });
    }
    return reread(ctx, input);
  }
  if (result.outcome === "recipe" && result.tables) {
    const tables: VisionTable[] = stored ?? result.tables;
    // A scan or photo with a table past the threshold makes no blocks: the page is read again in bands.
    const dense = a.kind !== "pdf_text" && tables.some((t) => t.rows.length > VISION_PARAMS.bandRowThreshold);
    if (!dense) await insertTables(ctx, a, input.page, index.index.pageCount, tables);
  }
  return reread(ctx, input);
}

/**
 * Contract section 11.3: one band of a page cut into bands, at most one call. Band 1 is read like a
 * page; bands 2..K get the headers of band 1's banded table as JSON data and must answer one table that
 * wide. When every band is read, the bands are merged and the page's blocks are built (no call).
 */
async function readBand(
  ctx: IngestCtx,
  a: ArtifactRow,
  bucket: R2Bucket,
  index: PagesIndex,
  f: PageFacts,
  band: BandFacts,
  view: VisionPageView,
  input: { artifactId: string; page: number; band?: number },
): Promise<VisionPageView> {
  if (input.band !== undefined && input.band > band.total) throw new TRPCError(MOVED);
  const target = input.band ?? view.bands!.next;
  if (target === null || bandRead(band.items[target - 1]!)) {
    if (view.bands!.next === null && view.state === "ready") return mergeAndInsert(ctx, a, bucket, index, input.page, band.total, view);
    return view;
  }
  const item = band.items[target - 1]!;
  if (item.inFlight) return view;
  const room = INGEST_LIMITS.blocksPerFile - f.fileBlocks;
  const plan = planKey(item.history, item.hasImage, item.hasTables, room);
  if (plan.state === "waiting") throw new TRPCError({ code: "BAD_REQUEST", message: VISION_UPLOAD_FIRST });
  if (plan.state === "not_read" && !plan.canRetry) return view;
  await assertRowRoom(ctx, a, 0);

  // Bands 2..K need band 1's headers: until band 1 is read, they wait.
  let headers: string[] | null = null;
  if (target >= 2) {
    const first = bandRead(band.items[0]!) ? await readJson<PageTablesFile>(bucket, bandTablesKey(ctx.companyId, a.sha256, input.page, 1)) : null;
    if (!first || !Array.isArray(first.body.tables) || first.body.tables.length === 0) return view;
    headers = first.body.tables[bandedTableIndex(first.body.tables)]!.headers;
  }
  const obj = await bucket.get(bandKey(ctx.companyId, a.sha256, input.page, target));
  if (!obj) throw new TRPCError({ code: "BAD_REQUEST", message: VISION_UPLOAD_FIRST });
  const bytes = new Uint8Array(await obj.arrayBuffer());
  const mediaType = (obj.httpMetadata?.contentType ?? VISION_PARAMS.pageContentType) as "image/jpeg";
  const bandTables = bandTablesKey(ctx.companyId, a.sha256, input.page, target);
  const result = await runVisionAttempt({
    env: anthropicEnv(),
    store: visionStore(ctx, lastCall(item.history)?.outcome === "recipe" && !item.hasTables),
    onTables: async (tables, runId, model) => {
      await putTablesOnce(bucket, bandTables, { v: 1, runId, model, tables }, a, ctx.companyId);
    },
    caps: modelCaps(await effectiveLimits(ctx)),
    companyId: ctx.companyId,
    userId: ctx.session.user.id,
    blockId: visionBandKey(a.id, input.page, target),
    pageKind: a.kind === "image" ? "image" : "pdf_scan",
    page: { mediaType, bytes },
    vaultReady: true,
    visualReads: true,
    band: headers ? { index: target, total: band.total, headers } : null,
    nowMs: () => now().getTime(),
  });
  if (result.status === "skipped") {
    if (result.reason === "page_too_large" || result.reason === "unsupported_page") {
      return { ...view, state: "not_read", reason: result.reason, canRetry: false, next: "manual" };
    }
    if (result.reason === "no_key" || result.reason === "vault_required") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: result.reason === "no_key" ? KEPT_UNREAD_NOT_READ : KEPT_UNREAD_NO_STORAGE });
    }
    return reread(ctx, input);
  }
  if (result.outcome === "recipe" && result.tables) {
    const after = await reread(ctx, input);
    if (after.bands?.next === null && after.state === "ready") return mergeAndInsert(ctx, a, bucket, index, input.page, band.total, after);
    return after;
  }
  return reread(ctx, input);
}

/** Merge the bands of a page whose bands are all read and build its blocks. No call. */
async function mergeAndInsert(ctx: IngestCtx, a: ArtifactRow, bucket: R2Bucket, index: PagesIndex, page: number, total: number, view: VisionPageView): Promise<VisionPageView> {
  const answers: VisionTable[][] = [];
  for (let k = 1; k <= total; k++) {
    const got = await readJson<PageTablesFile>(bucket, bandTablesKey(ctx.companyId, a.sha256, page, k));
    if (!got || !Array.isArray(got.body.tables)) return view;
    answers.push(got.body.tables);
  }
  const merged = mergeBands(answers[0]!, answers.slice(1));
  // Each band was checked for width when it was read, so this does not happen; it is manual if it does.
  if (!merged) return { ...view, state: "not_read", reason: "invalid", canRetry: false, next: "manual" };
  const wrote = await insertTables(ctx, a, page, index.pageCount, merged.tables, total);
  return afterRebuild(ctx, { artifactId: a.id, page }, wrote);
}

/**
 * Contract section 6: a rebuild that wrote nothing while the page still asks for one throws, so the web
 * stops its loop on the error and never spins on `next: "retry"` (S2). Not CONFLICT: the pump reads a
 * page again on CONFLICT.
 */
async function afterRebuild(ctx: IngestCtx, input: { artifactId: string; page: number }, wrote: number): Promise<VisionPageView> {
  const after = await reread(ctx, input);
  if (wrote === 0 && after.state === "ready" && after.next === "retry") throw new TRPCError({ code: "BAD_REQUEST", message: VISION_REBUILD_FAILED });
  return after;
}

/** The plant's open-rows sentence (as `artifact.begin` says it). */
const OPEN_ROWS_FULL = "Too many rows are waiting. Merge or discard older imports first.";
/** The rows-per-file sentence (as `artifact.putBlocks` says it). */
const fileRowsFull = (fileName: string, limit: number) => `${fileName} has more than ${limit.toLocaleString("en-US")} rows. Split it and try again.`;

/**
 * S3: model-read and typed rows count against the plant's `rawRowsPerFile` and `openRowsPerPlant`
 * (`effectiveLimits`), as a sheet's rows do. `rows` is what the write adds; 0 checks that there is room
 * for any row at all (before a model call). PRECONDITION_FAILED, so the screen shows the sentence.
 */
async function assertRowRoom(ctx: IngestCtx, a: ArtifactRow, rows: number): Promise<{ rawRowsPerFile: number }> {
  const limits = await effectiveLimits(ctx);
  const fresh = await loadArtifact(ctx, a.id);
  const over = (have: number, limit: number) => (rows === 0 ? have >= limit : have + rows > limit);
  if (over(fresh.rowCount, limits.rawRowsPerFile)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: fileRowsFull(a.fileName, limits.rawRowsPerFile) });
  if (over(await openStagedRows(ctx), limits.openRowsPerPlant)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: OPEN_ROWS_FULL });
  return { rawRowsPerFile: limits.rawRowsPerFile };
}

/**
 * Contract section 11.3: cut a page into `bands` bands (2..4) and hand one upload ticket per band with no
 * image yet. The cut is written once into the page plan; the same count again hands the missing tickets,
 * another count is refused as a change from another tab.
 */
export async function visionBandTickets(ctx: IngestCtx, input: { artifactId: string; page: number; bands: number }): Promise<VisionBandTicketsOut> {
  const { a, bucket, index } = await readingFile(ctx, input.artifactId);
  plannedPage(index.index, input.page);
  const view = (await loadFacts(ctx, bucket, a, index, input.page)).pages[0]!;
  if (view.state === "read" || view.state === "typed") throw new TRPCError({ code: "BAD_REQUEST", message: VISION_PAGE_READ });
  const have = bandsOf(index.index, input.page);
  if (have && have !== input.bands) throw new TRPCError(MOVED);
  if (!have) {
    const body: PagesIndex = { ...index.index, bands: { ...(index.index.bands ?? {}), [String(input.page)]: input.bands } };
    const put = await bucket.put(pagesIndexKey(ctx.companyId, a.sha256), JSON.stringify(body), {
      onlyIf: { etagMatches: index.etag },
      httpMetadata: { contentType: "application/json" },
      customMetadata: { companyId: ctx.companyId, artifactId: a.id },
    });
    if (!put) throw new TRPCError(MOVED);
    await guardedBatch(ctx.db, [
      auditInsert(ctx, { action: "ingest.vision.bands", subjectType: "ingest_artifact", subjectId: a.id, meta: { page: input.page, bands: input.bands } }),
    ]);
  }
  const uploads: VisionBandTicketsOut["uploads"] = [];
  for (let k = 1; k <= input.bands; k++) {
    const key = bandKey(ctx.companyId, a.sha256, input.page, k);
    if (await bucket.head(key)) continue;
    const t = await issueTicket(ctx, {
      purpose: "ingest-page",
      companyId: ctx.companyId,
      userId: ctx.session.user.id,
      artifactId: a.id,
      sha256: a.sha256,
      key,
      size: VISION_PARAMS.maxPageBytes,
      exactSize: false,
      contentType: VISION_PARAMS.pageContentType,
      fileName: `${input.page}-b${k}.jpg`,
    });
    uploads.push({ band: k, url: t.url, ticket: t.ticket, expiresAt: t.expiresAt });
  }
  return { page: input.page, total: input.bands, uploads };
}

async function reread(ctx: IngestCtx, input: { artifactId: string; page: number }): Promise<VisionPageView> {
  const a = await loadArtifact(ctx, input.artifactId);
  const bucket = needVault();
  const index = await loadIndex(bucket, ctx, a);
  if (!index) throw new TRPCError({ code: "BAD_REQUEST", message: VISION_NOT_READING });
  return (await loadFacts(ctx, bucket, a, index, input.page)).pages[0]!;
}

/** The ordinals of a page: its tables take `visionOrdinal(page, 0..tablesPerPage - 1)`. */
function pageOrdinals(page: number): { lo: number; hi: number } {
  return { lo: visionOrdinal(page, 0), hi: visionOrdinal(page, VISION_PARAMS.tablesPerPage - 1) };
}

/** Headers padded and normalized as `putBlocks` does, with kinds and the fingerprint of the fit. */
function fingerprintOf(headers: readonly string[], sample: string[][]) {
  const width = Math.min(Math.max(headers.length, ...sample.map((r) => r.length), 0), INGEST_LIMITS.columnsPerBlock);
  const padded = [...headers.map((h) => h.slice(0, INGEST_LIMITS.cellChars)), ...Array<string>(Math.max(0, width - headers.length)).fill("")].slice(0, width);
  const normalized = normalizeHeaders(padded, width);
  return { headers: padded, normalized, columnCount: width, kinds: inferKinds(sample, width), headerKey: headerKey(normalized), headerRow: 0, headerRows: 1 };
}

/** One table of a page as a block, its candidate and its staged rows: the statements after the guard. */
async function tableStatements(
  ctx: IngestCtx,
  a: ArtifactRow,
  learned: Awaited<ReturnType<typeof learnedHoles>>,
  t: { ordinal: number; title: string | null; headers: string[]; rows: string[][]; readBy: "parser" | "model"; headerBy: "reader" | "person"; vision: StoredVision },
  at: Date,
): Promise<{ statements: SqliteBatchItem[]; blockId: string; candidateId: string; target: ReturnType<typeof fitBlock>["target"]; rows: string[][] }> {
  const rows = padRows(t.headers, t.rows);
  const sample = capSample(rows.slice(0, INGEST_LIMITS.sampleRowsPerBlock).map((r) => r.map((c) => c.slice(0, INGEST_LIMITS.cellChars))));
  const fp = fingerprintOf(t.headers, sample);
  const fit = fitBlock(fp, learned);
  const blockId = createId();
  const candidateId = createId();
  // S5: the first batch stages at most `rowsPerPut` rows; `rowsPut` says how many, and `topUpRows` writes
  // the rest of a merged banded table batch by batch.
  const first = Math.min(rows.length, ROWS_PER_BATCH);
  const staged = await Promise.all(
    rows.slice(0, first).map((cells, i) => stagedRowOf(ctx, { artifactId: a.id, ordinal: t.ordinal, rowIndex: i, cells, candidateId, target: fit.target, doubts: null, at })),
  );
  const out: SqliteBatchItem[] = [
    ctx.db.insert(ingestBlock).values({
      id: blockId,
      companyId: ctx.companyId,
      artifactId: a.id,
      ordinal: t.ordinal,
      sheetName: null,
      title: t.title,
      headerRow: 0,
      headerRows: 1,
      headerBy: t.headerBy,
      headerPick: null,
      merged: null,
      readerFacts: { gaps: 0, warnings: [], warningsTotal: 0, sections: [], sectionsTotal: 0, vision: t.vision },
      follows: null,
      headers: fp.headers,
      kinds: fp.kinds,
      headerKey: fp.headerKey,
      columnCount: fp.columnCount,
      rowCount: rows.length,
      rowsPut: first,
      sample: sample.map((r) => r.slice(0, fp.columnCount)),
      readBy: t.readBy,
      modelChecked: false,
      createdAt: at,
    }),
    ctx.db.insert(ingestCandidate).values({
      id: candidateId,
      companyId: ctx.companyId,
      artifactId: a.id,
      blockId,
      parentId: null,
      target: fit.target,
      holeRef: fit.holeRef,
      recipe: fit.recipe as never,
      fit: fit.fit,
      fitScore: fit.fit === "none" ? null : fit.score,
      fitDiff: fitDiffJson(fit),
      state: stateForFit(fit),
      rowsTotal: rows.length,
      // One millisecond an ordinal, as putBlocks does, so the tables of a file keep their order.
      createdAt: new Date(at.getTime() + t.ordinal),
      updatedAt: at,
    }),
  ];
  pushChunkedInserts(out, (part) => ctx.db.insert(ingestStagedRow).values(part), staged);
  return { statements: out, blockId, candidateId, target: fit.target, rows };
}

/** Rows of a staged write: at most `rowsPerPut` (500) a batch, the size `putRows` writes (contract section 6). */
const ROWS_PER_BATCH = INGEST_LIMITS.rowsPerPut;

/** Rows cut to the block's columns and padded to its headers, as stored. */
function padRows(headers: readonly string[], rows: readonly (readonly string[])[]): string[][] {
  return rows.map((r) => {
    const cut = r.slice(0, INGEST_LIMITS.columnsPerBlock);
    return [...cut, ...Array<string>(Math.max(0, headers.length - cut.length)).fill("")].slice(0, Math.max(headers.length, 1));
  });
}

/**
 * S5: the staged rows of a model block past `rowsPut`, one batch of `rowsPerPut` rows at a time. Each batch
 * moves `rowsPut` only from the value it read (in the statement's own WHERE) with its abort statement, so
 * two tabs never write the same rows; a lost race stops quietly (the other tab writes them). Answers the
 * batches written.
 */
async function topUpRows(
  ctx: IngestCtx,
  a: ArtifactRow,
  block: { id: string; ordinal: number; rowsPut: number },
  candidate: { id: string; target: ReturnType<typeof fitBlock>["target"] },
  rows: readonly string[][],
): Promise<number> {
  let wrote = 0;
  for (let start = block.rowsPut; start < rows.length; start += ROWS_PER_BATCH) {
    const end = Math.min(rows.length, start + ROWS_PER_BATCH);
    const at = now();
    const staged = await Promise.all(
      rows.slice(start, end).map((cells, j) => stagedRowOf(ctx, { artifactId: a.id, ordinal: block.ordinal, rowIndex: start + j, cells, candidateId: candidate.id, target: candidate.target, doubts: null, at })),
    );
    const statements: SqliteBatchItem[] = [
      ctx.db
        .update(ingestBlock)
        .set({ rowsPut: end })
        .where(and(eq(ingestBlock.id, block.id), eq(ingestBlock.companyId, ctx.companyId), eq(ingestBlock.rowsPut, start))),
      ingestAbortUnlessChanged(ctx.db),
    ];
    pushChunkedInserts(statements, (part) => ctx.db.insert(ingestStagedRow).values(part), staged);
    try {
      await guardedBatch(ctx.db, statements);
    } catch (e) {
      if (e instanceof TRPCError && e.code === "CONFLICT") return wrote;
      throw e;
    }
    wrote += 1;
  }
  return wrote;
}

/**
 * The guard of one page write: the file is still read page by page, has room for one more block and for
 * its rows under the plant's rows per file, and the page holds no block of the other kind (a typed table
 * and model tables never share a page).
 */
function pageGuard(ctx: IngestCtx, a: ArtifactRow, page: number, other: "parser" | "model", rows: number, at: Date, rawRowsPerFile: number): SqliteBatchItem[] {
  const { lo, hi } = pageOrdinals(page);
  return [
    ctx.db
      .update(ingestArtifact)
      .set({ blockCount: sql`${ingestArtifact.blockCount} + 1`, rowCount: sql`${ingestArtifact.rowCount} + ${rows}`, updatedAt: at })
      .where(
        and(
          eq(ingestArtifact.id, a.id),
          eq(ingestArtifact.companyId, ctx.companyId),
          eq(ingestArtifact.readState, "reading"),
          sql`${ingestArtifact.blockCount} < ${INGEST_LIMITS.blocksPerFile}`,
          // S3: the file's rows stay within the plant's rows per file, checked in the write itself.
          sql`${ingestArtifact.rowCount} + ${rows} <= ${rawRowsPerFile}`,
          sql`not exists (select 1 from ingest_block b where b.artifact_id = ${a.id} and b.company_id = ${ctx.companyId} and b.ordinal between ${lo} and ${hi} and b.read_by = ${other})`,
        ),
      ),
    ingestAbortUnlessChanged(ctx.db),
  ];
}

const isBlockUnique = (e: unknown) => {
  for (let cur: unknown = e, depth = 0; cur && depth < 6; depth += 1) {
    if (/UNIQUE constraint failed: ingest_block/.test(cur instanceof Error ? cur.message : String(cur))) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
};

/**
 * Contract section 6: each table of the page not yet a block becomes one, one table per batch (each
 * guarded on its own ordinal by the unique index). The room for every missing table, and for its rows
 * under the plant's row limits (S3), is checked before the first. A table another tab already wrote is
 * taken as written; a block cut short by a stopped batch gets the rest of its rows (S5). Answers how many
 * batches it wrote, so a rebuild that wrote nothing can say so.
 */
async function insertTables(ctx: IngestCtx, a: ArtifactRow, page: number, pageCount: number, tables: readonly VisionTable[], bands = 0): Promise<number> {
  const list = tables.slice(0, VISION_PARAMS.tablesPerPage);
  const { lo, hi } = pageOrdinals(page);
  const have = await ctx.db
    .select({ id: ingestBlock.id, ordinal: ingestBlock.ordinal, readBy: ingestBlock.readBy, rowsPut: ingestBlock.rowsPut, rowCount: ingestBlock.rowCount })
    .from(ingestBlock)
    .where(and(eq(ingestBlock.companyId, ctx.companyId), eq(ingestBlock.artifactId, a.id), sql`${ingestBlock.ordinal} between ${lo} and ${hi}`));
  let wrote = 0;
  for (const b of have) {
    if (b.readBy !== "model" || b.rowsPut >= b.rowCount) continue;
    const i = list.findIndex((_, k) => visionOrdinal(page, k) === b.ordinal);
    if (i < 0) continue;
    const [c] = await ctx.db
      .select({ id: ingestCandidate.id, target: ingestCandidate.target })
      .from(ingestCandidate)
      .where(and(eq(ingestCandidate.companyId, ctx.companyId), eq(ingestCandidate.blockId, b.id), sql`${ingestCandidate.parentId} is null`))
      .limit(1);
    if (!c) continue;
    wrote += await topUpRows(ctx, a, b, c, padRows(list[i]!.headers, list[i]!.rows));
  }
  const taken = new Set(have.map((b) => b.ordinal));
  const missing = list.map((t, i) => ({ t, i })).filter((x) => !taken.has(visionOrdinal(page, x.i)));
  if (missing.length === 0) return wrote;
  const fresh = await loadArtifact(ctx, a.id);
  if (fresh.blockCount + missing.length > INGEST_LIMITS.blocksPerFile) return wrote;
  const { rawRowsPerFile } = await assertRowRoom(ctx, a, missing.reduce((n, x) => n + x.t.rows.length, 0));
  const learned = await learnedHoles(ctx);
  // The digit check reads the page's text once; missing text only means no marks.
  const bucket = ingestVault();
  const items = bucket ? await loadPageText(bucket, ctx, a, page) : null;
  for (const { t, i } of missing) {
    const at = now();
    const ordinal = visionOrdinal(page, i);
    const built = await tableStatements(
      ctx,
      a,
      learned,
      {
        ordinal,
        title: t.title,
        headers: t.headers,
        rows: t.rows,
        readBy: "model",
        headerBy: "reader",
        vision: { page, table: i, pageCount, rowConfidence: t.rowConfidence, tables: list.length, unseen: unseenCells(t.rows, items), ...(bands ? { bands } : {}) },
      },
      at,
    );
    const statements: SqliteBatchItem[] = [
      ...pageGuard(ctx, a, page, "parser", t.rows.length, at, rawRowsPerFile),
      ...built.statements,
      auditInsert(ctx, { action: "ingest.vision.page", subjectType: "ingest_artifact", subjectId: a.id, meta: { page, table: i, ordinal, rows: t.rows.length } }),
    ];
    try {
      await guardedBatch(ctx.db, statements);
    } catch (e) {
      if (isBlockUnique(e)) continue;
      if (e instanceof TRPCError && e.code === "CONFLICT") {
        // The guard failed: the file left page reading, filled up, reached its rows per file, or a person typed this page.
        const now2 = await loadArtifact(ctx, a.id);
        if (now2.readState !== "reading") throw new TRPCError({ code: "BAD_REQUEST", message: VISION_NOT_READING });
        if (now2.rowCount + t.rows.length > rawRowsPerFile) throw new TRPCError({ code: "PRECONDITION_FAILED", message: fileRowsFull(a.fileName, rawRowsPerFile) });
        return wrote;
      }
      throw e;
    }
    wrote += 1;
    wrote += await topUpRows(ctx, a, { id: built.blockId, ordinal, rowsPut: Math.min(built.rows.length, ROWS_PER_BATCH) }, { id: built.candidateId, target: built.target }, built.rows);
  }
  return wrote;
}

// ---------------------------------------------------------------------------
// skipPage / typePage
// ---------------------------------------------------------------------------

export async function visionSkipPage(ctx: IngestCtx, input: { artifactId: string; page: number }): Promise<VisionPageView> {
  const { a, bucket, index } = await readingFile(ctx, input.artifactId);
  plannedPage(index.index, input.page);
  const view = (await loadFacts(ctx, bucket, a, index, input.page)).pages[0]!;
  if (view.state === "skipped") return view;
  if (view.state === "read" || view.state === "typed") throw new TRPCError({ code: "BAD_REQUEST", message: VISION_PAGE_READ });
  const body: PagesIndex = { ...index.index, skipped: [...new Set([...index.index.skipped, input.page])].sort((x, y) => x - y) };
  const put = await bucket.put(pagesIndexKey(ctx.companyId, a.sha256), JSON.stringify(body), {
    onlyIf: { etagMatches: index.etag },
    httpMetadata: { contentType: "application/json" },
    customMetadata: { companyId: ctx.companyId, artifactId: a.id },
  });
  // Another tab changed the plan in between (R2 answers null when the etag no longer matches).
  if (!put) throw new TRPCError(MOVED);
  await guardedBatch(ctx.db, [auditInsert(ctx, { action: "ingest.vision.skip", subjectType: "ingest_artifact", subjectId: a.id, meta: { page: input.page } })]);
  return reread(ctx, input);
}

export async function visionTypePage(
  ctx: IngestCtx,
  input: { artifactId: string; page: number; title: string | null; headers: string[]; rows: string[][] },
): Promise<VisionPageView> {
  const { a, bucket, index } = await readingFile(ctx, input.artifactId);
  plannedPage(index.index, input.page);
  const view = (await loadFacts(ctx, bucket, a, index, input.page)).pages[0]!;
  if (view.state === "read" || view.state === "typed") throw new TRPCError({ code: "BAD_REQUEST", message: VISION_PAGE_READ });
  const { rawRowsPerFile } = await assertRowRoom(ctx, a, input.rows.length);
  const at = now();
  const ordinal = visionOrdinal(input.page, 0);
  const statements: SqliteBatchItem[] = [
    ...pageGuard(ctx, a, input.page, "model", input.rows.length, at, rawRowsPerFile),
    ...(
      await tableStatements(
      ctx,
      a,
      await learnedHoles(ctx),
      {
        ordinal,
        title: input.title?.trim() || null,
        headers: input.headers,
        rows: input.rows,
        readBy: "parser",
        headerBy: "person",
        vision: { page: input.page, table: 0, pageCount: index.index.pageCount, rowConfidence: [], tables: 1, typed: true },
      },
      at,
      )
    ).statements,
    auditInsert(ctx, { action: "ingest.vision.type", subjectType: "ingest_artifact", subjectId: a.id, meta: { page: input.page, ordinal, rows: input.rows.length, columns: input.headers.length } }),
  ];
  try {
    await guardedBatch(ctx.db, statements);
  } catch (e) {
    if (isBlockUnique(e)) throw new TRPCError(MOVED);
    if (isIngestAbort(e) || (e instanceof TRPCError && e.code === "CONFLICT")) {
      const now2 = await loadArtifact(ctx, a.id);
      if (now2.readState !== "reading") throw new TRPCError({ code: "BAD_REQUEST", message: VISION_NOT_READING });
      if (now2.rowCount + input.rows.length > rawRowsPerFile) throw new TRPCError({ code: "PRECONDITION_FAILED", message: fileRowsFull(a.fileName, rawRowsPerFile) });
      const again = await reread(ctx, input);
      if (again.state === "read" || again.state === "typed") throw new TRPCError({ code: "BAD_REQUEST", message: VISION_PAGE_READ });
      if (again.reason === "too_many_tables" || now2.blockCount >= INGEST_LIMITS.blocksPerFile) return { ...again, state: "not_read", reason: "too_many_tables", canRetry: false, next: "manual" };
      throw new TRPCError(MOVED);
    }
    throw e;
  }
  return reread(ctx, input);
}

// ---------------------------------------------------------------------------
// readUrl
// ---------------------------------------------------------------------------

export async function visionReadUrl(
  ctx: IngestCtx,
  input: { artifactId: string; what: "raw" } | { artifactId: string; what: "page"; page: number; band?: number },
): Promise<VisionReadUrlOut> {
  // The key is built here from the caller's company and the artifact row loaded under it.
  const a = await loadArtifact(ctx, input.artifactId);
  const bucket = needVault();
  // Gate 5 (chunked upload): the raw file is signed for reading only once its whole SHA-256 is checked.
  if (input.what === "raw" && a.vaultState !== "stored") throw new TRPCError({ code: "NOT_FOUND", message: "Import file not found" });
  const key =
    input.what === "raw"
      ? rawKey(ctx.companyId, a.sha256)
      : input.band !== undefined
        ? bandKey(ctx.companyId, a.sha256, input.page, input.band)
        : pageKey(ctx.companyId, a.sha256, input.page);
  if (!(await bucket.head(key))) throw new TRPCError({ code: "NOT_FOUND", message: "Import file not found" });
  return issueReadTicket(ctx, { companyId: ctx.companyId, userId: ctx.session.user.id, artifactId: a.id, sha256: a.sha256, key, as: input.what });
}
