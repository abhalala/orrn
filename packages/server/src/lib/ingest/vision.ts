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
import { fitBlock, headerKey, inferKinds, normalizeHeaders, VISION_PARAMS, visionOrdinal, visionPageKey } from "@orrn/ingest";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { ingestArtifact, ingestBlock, ingestBotRun, ingestCandidate, ingestStagedRow } from "@orrn/db/schema/ingest";

import { pushChunkedInserts, type SqliteBatchItem } from "../atomic";
import { auditInsert } from "../audit";
import { now } from "../clock";
import { createId } from "../id";
import { stagedRowOf } from "./artifacts";
import { countCalls, historyOutcome, planVision, runVisionAttempt, SONNET, shapeBotReady, type BotRunHistoryRow, type BotRunStore, type VisionTable } from "./bot";
import { capSample, fitDiffJson, learnedHoles, stateForFit } from "./candidates";
import { guardedBatch, ingestAbortUnlessChanged, isIngestAbort, loadArtifact, MOVED, type ArtifactRow, type StoredVision } from "./core";
import { anthropicEnv, botRunStore } from "./engines";
import { artifactPrefix, ingestVault, issueReadTicket, issueTicket, pageKey, pagesIndexKey, pageTablesKey, pageTextKey, rawKey, vaultReady } from "./vault";
import {
  INGEST_LIMITS,
  KEPT_UNREAD_NO_STORAGE,
  VISION_ALREADY_READ,
  VISION_KINDS_ONLY,
  VISION_NOT_READING,
  VISION_NOT_STORED,
  VISION_PAGE_PAST,
  VISION_PAGE_READ,
  VISION_UPLOAD_FIRST,
  KEPT_UNREAD_NOT_READ,
  isVisualKind,
  type IngestCtx,
  type VisionNotReadReason,
  type VisionPagesOut,
  type VisionPageView,
  type VisionReadUrlOut,
  type VisionStartOut,
} from "./types";

// ---------------------------------------------------------------------------
// Page index (contract section 5)
// ---------------------------------------------------------------------------

export type PagesIndex = { v: 1; pageCount: number; planned: number; skipped: number[]; startedBy: string; startedAt: number };

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

/** The digit runs of a string: `\d+` after a comma between two digits is removed (1,23,456 is 123456). */
export function digitRuns(s: string): string[] {
  return s.replace(/(?<=\d),(?=\d)/g, "").match(/\d+/g) ?? [];
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
 * de-duplicated, since the cuts have no overlap. Band 1's other tables stay as they are, in place. Null
 * when band 1 has no table, a later band is not exactly one table, or any row is not as wide as the headers.
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

export type PageBlock = { id: string; readBy: "parser" | "model"; typed: boolean; tables: number };

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
};

const CAP_REASON: Record<string, VisionNotReadReason> = {
  "cap:block_calls": "cap_page",
  "cap:day_calls": "cap_day_calls",
  "cap:day_cost": "cap_day_cost",
};

/**
 * The view of one page (pure). Settled first (typed, all tables read, skipped), then the run plan.
 * `next: "retry"` comes back only when the next `readPage` makes a call or rebuilds blocks; a file with
 * no room for the page's tables, and a `recipe` run whose tables never reached the vault, are manual.
 */
export function derivePage(f: PageFacts): VisionPageView {
  const attempts = countCalls(f.history);
  const blockIds = f.blocks.map((b) => b.id);
  const view = (v: Pick<VisionPageView, "state" | "reason" | "canRetry" | "next"> & { tables?: number }): VisionPageView => ({
    page: f.page,
    attempts,
    blockIds,
    tables: v.tables ?? f.blocks.length,
    state: v.state,
    reason: v.reason,
    canRetry: v.canRetry,
    next: v.next,
  });
  const notRead = (reason: VisionNotReadReason, canRetry = false) => view({ state: "not_read", reason, canRetry, next: "manual" });

  if (f.blocks.some((b) => b.typed)) return view({ state: "typed", reason: null, canRetry: false, next: "done" });
  const model = f.blocks.filter((b) => b.readBy === "model");
  const expected = Math.max(0, ...model.map((b) => b.tables));
  if (model.length > 0 && model.length >= expected) return view({ state: "read", reason: null, canRetry: false, next: "done" });
  if (f.skipped) return view({ state: "skipped", reason: null, canRetry: false, next: "done" });

  const room = INGEST_LIMITS.blocksPerFile - f.fileBlocks;
  if (model.length > 0) {
    // Part of the page's tables are blocks: the rest are rebuilt from the tables object.
    const missing = (f.tablesInFile ?? expected) - model.length;
    if (!f.hasTables) return notRead("error");
    if (missing > room) return notRead("too_many_tables");
    return view({ state: "ready", reason: null, canRetry: false, next: "retry", tables: f.tablesInFile ?? expected });
  }

  const calls = f.history.filter((h) => h.outcome !== "capped");
  const lastReal = calls.at(-1);
  if (lastReal?.outcome === "recipe" && f.hasTables) {
    const n = f.tablesInFile ?? 0;
    if (n > room) return notRead("too_many_tables");
    return view({ state: "ready", reason: null, canRetry: false, next: "retry", tables: n });
  }
  if (!f.hasImage) return view({ state: "waiting", reason: null, canRetry: false, next: null, tables: 0 });
  if (room <= 0) return notRead("too_many_tables");

  // A recipe run whose tables never reached the vault is not a done page; it counts as an error.
  const orphan = lastReal?.outcome === "recipe" && !f.hasTables;
  const history = orphanHistory(f.history, orphan);
  const last = f.history.at(-1);
  if (last?.outcome === "capped") return notRead(CAP_REASON[(last.errorCodes ?? [])[0] ?? ""] ?? "cap_day_calls", true);
  const plan = planVision(history, SONNET);
  if (plan.next === "retry" || plan.next === "escalate") {
    if (orphan) return notRead("error", true);
    return view({ state: "ready", reason: null, canRetry: false, next: calls.length === 0 ? null : "retry", tables: 0 });
  }
  const real = history.filter((h) => h.outcome !== "capped");
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
  blockRows: { id: string; ordinal: number; readBy: "parser" | "model"; vision: StoredVision | null }[];
};

/** Reads the facts of every planned page (or only `only`): one listing, one runs query, one blocks query. */
async function loadFacts(ctx: IngestCtx, bucket: R2Bucket, a: ArtifactRow, index: { index: PagesIndex; etag: string }, only?: number): Promise<FileFacts> {
  const planned = index.index.planned;
  const pages = only !== undefined ? [only] : Array.from({ length: planned }, (_, i) => i + 1);
  const prefix = `${artifactPrefix(ctx.companyId, a.sha256)}/pages/`;
  const keys = new Set<string>();
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const listed = await bucket.list({ prefix, ...(cursor ? { cursor } : {}) });
    for (const o of listed.objects) keys.add(o.key);
    if (!listed.truncated) break;
    cursor = listed.cursor;
  }
  const runKeys = pages.map((p) => visionPageKey(a.id, p));
  const runs = runKeys.length
    ? await ctx.db
        .select({ blockId: ingestBotRun.blockId, attempt: ingestBotRun.attempt, model: ingestBotRun.model, outcome: ingestBotRun.outcome, errorCodes: ingestBotRun.errorCodes })
        .from(ingestBotRun)
        .where(and(eq(ingestBotRun.companyId, ctx.companyId), eq(ingestBotRun.purpose, "vision"), inArray(ingestBotRun.blockId, runKeys)))
        .orderBy(asc(ingestBotRun.createdAt), asc(ingestBotRun.attempt))
    : [];
  const blocks = await ctx.db
    .select({ id: ingestBlock.id, ordinal: ingestBlock.ordinal, readBy: ingestBlock.readBy, readerFacts: ingestBlock.readerFacts })
    .from(ingestBlock)
    .where(and(eq(ingestBlock.companyId, ctx.companyId), eq(ingestBlock.artifactId, a.id)))
    .orderBy(asc(ingestBlock.ordinal));
  const blockRows = blocks.map((b) => ({ id: b.id, ordinal: b.ordinal, readBy: b.readBy, vision: b.readerFacts?.vision ?? null }));
  const skipped = new Set(index.index.skipped);
  const facts: PageFacts[] = [];
  for (const p of pages) {
    const key = visionPageKey(a.id, p);
    const history = runs.filter((r) => r.blockId === key).map((r) => ({ attempt: r.attempt, model: r.model, outcome: historyOutcome(r.outcome), errorCodes: r.errorCodes }));
    const onPage = blockRows
      .filter((b) => b.vision?.page === p)
      .map((b) => ({ id: b.id, readBy: b.readBy, typed: b.vision?.typed === true, tables: b.vision?.tables ?? 1 }));
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
    };
    // The tables object is read only for a page whose blocks are not all there yet (rare).
    if (hasTables && !isSettled(derivePage(f))) {
      const got = await readJson<PageTablesFile>(bucket, pageTablesKey(ctx.companyId, a.sha256, p));
      // An object that cannot be read is as good as none: the page is not rebuilt from it.
      if (got && Array.isArray(got.body?.tables)) f.tablesInFile = got.body.tables.length;
      else f.hasTables = false;
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
      planned: Math.min(input.pageCount, VISION_PARAMS.maxPagesPerFile),
      skipped: [],
      startedBy: ctx.session.user.id,
      startedAt: now().getTime(),
    };
    const put = await bucket.put(pagesIndexKey(ctx.companyId, a.sha256), JSON.stringify(body), {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { companyId: ctx.companyId, artifactId: a.id },
    });
    index = { index: body, etag: put.etag };
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
  const prefix = `${artifactPrefix(ctx.companyId, a.sha256)}/pages/`;
  const listed = await bucket.list({ prefix });
  const have = new Set(listed.objects.map((o) => o.key));
  const uploads: VisionStartOut["uploads"] = [];
  for (let p = 1; p <= index.index.planned; p++) {
    const key = pageKey(ctx.companyId, a.sha256, p);
    if (have.has(key)) continue;
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
      fileName: `${p}.jpg`,
    });
    uploads.push({ page: p, url: t.url, ticket: t.ticket, expiresAt: t.expiresAt });
  }
  // A text PDF page also sends its pdfjs text for the digit check (contract section 11.5).
  const texts: VisionStartOut["texts"] = [];
  if (a.kind === "pdf_text") {
    for (let p = 1; p <= index.index.planned; p++) {
      const key = pageTextKey(ctx.companyId, a.sha256, p);
      if (have.has(key)) continue;
      const t = await issueTicket(ctx, {
        purpose: "ingest-page",
        companyId: ctx.companyId,
        userId: ctx.session.user.id,
        artifactId: a.id,
        sha256: a.sha256,
        key,
        size: VISION_PARAMS.maxPageTextBytes,
        exactSize: false,
        contentType: "application/json",
        fileName: `${p}.text.json`,
      });
      texts.push({ page: p, url: t.url, ticket: t.ticket, expiresAt: t.expiresAt });
    }
  }
  return { pageCount: index.index.pageCount, planned: index.index.planned, uploads, texts };
}

/** Every planned page with its state. A file not started yet (kept, or read before release 2) has no pages. */
export async function visionPages(ctx: IngestCtx, input: { artifactId: string }): Promise<VisionPagesOut> {
  const a = await loadArtifact(ctx, input.artifactId);
  if (!isVisualKind(a.kind)) throw new TRPCError({ code: "BAD_REQUEST", message: VISION_KINDS_ONLY });
  const bucket = ingestVault();
  const index = bucket ? await loadIndex(bucket, ctx, a) : null;
  if (!bucket || !index) return { pageCount: 0, planned: 0, pages: [], settled: false };
  const f = await loadFacts(ctx, bucket, a, index);
  return { pageCount: f.index.pageCount, planned: f.index.planned, pages: f.pages, settled: f.pages.every(isSettled) };
}

/** Contract section 4: whether every planned page of a visual file is read, typed or skipped. */
export async function visionAllSettled(ctx: IngestCtx, a: ArtifactRow): Promise<boolean> {
  const bucket = ingestVault();
  const index = bucket ? await loadIndex(bucket, ctx, a) : null;
  if (!bucket || !index) return false;
  return (await loadFacts(ctx, bucket, a, index)).pages.every(isSettled);
}

// ---------------------------------------------------------------------------
// readPage
// ---------------------------------------------------------------------------

/** The run store, with a page's recipe runs seen as errors when their tables never reached the vault. */
function pageStore(base: BotRunStore, orphan: boolean): BotRunStore {
  if (!orphan) return base;
  return { ...base, listBlockRuns: async (args) => orphanHistory(await base.listBlockRuns(args), true) };
}

export async function visionReadPage(ctx: IngestCtx, input: { artifactId: string; page: number }): Promise<VisionPageView> {
  const { a, bucket, index } = await readingFile(ctx, input.artifactId);
  plannedPage(index.index, input.page);
  const facts = await loadFacts(ctx, bucket, a, index, input.page);
  const f = facts.facts[0]!;
  const view = facts.pages[0]!;
  if (isSettled(view)) return view;
  if (view.state === "waiting") throw new TRPCError({ code: "BAD_REQUEST", message: VISION_UPLOAD_FIRST });
  if (view.state === "not_read" && !view.canRetry) return view;

  // A rebuild: the tables are in the vault but not all of them are blocks yet. No model call.
  if (view.state === "ready" && f.hasTables && (f.blocks.length > 0 || f.history.filter((h) => h.outcome !== "capped").at(-1)?.outcome === "recipe")) {
    const got = await readJson<PageTablesFile>(bucket, pageTablesKey(ctx.companyId, a.sha256, input.page));
    if (got && Array.isArray(got.body.tables)) {
      await insertTables(ctx, a, input.page, index.index.pageCount, got.body.tables);
      return reread(ctx, input);
    }
  }

  const obj = await bucket.get(pageKey(ctx.companyId, a.sha256, input.page));
  if (!obj) throw new TRPCError({ code: "BAD_REQUEST", message: VISION_UPLOAD_FIRST });
  const bytes = new Uint8Array(await obj.arrayBuffer());
  const mediaType = (obj.httpMetadata?.contentType ?? VISION_PARAMS.pageContentType) as "image/jpeg";
  const lastReal = f.history.filter((h) => h.outcome !== "capped").at(-1);
  const result = await runVisionAttempt({
    env: anthropicEnv(),
    store: pageStore(botRunStore(ctx), lastReal?.outcome === "recipe" && !f.hasTables),
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
    // The tables go to the vault before the blocks, so a batch that fails is rebuilt with no new call.
    const file: PageTablesFile = { v: 1, runId: result.runId, model: result.model, tables: result.tables };
    await bucket.put(pageTablesKey(ctx.companyId, a.sha256, input.page), JSON.stringify(file), {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { companyId: ctx.companyId, artifactId: a.id },
    });
    await insertTables(ctx, a, input.page, index.index.pageCount, result.tables);
  }
  return reread(ctx, input);
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
): Promise<SqliteBatchItem[]> {
  const rows = t.rows.map((r) => {
    const cut = r.slice(0, INGEST_LIMITS.columnsPerBlock);
    return [...cut, ...Array<string>(Math.max(0, t.headers.length - cut.length)).fill("")].slice(0, Math.max(t.headers.length, 1));
  });
  const sample = capSample(rows.slice(0, INGEST_LIMITS.sampleRowsPerBlock).map((r) => r.map((c) => c.slice(0, INGEST_LIMITS.cellChars))));
  const fp = fingerprintOf(t.headers, sample);
  const fit = fitBlock(fp, learned);
  const blockId = createId();
  const candidateId = createId();
  const staged = await Promise.all(
    rows.map((cells, i) => stagedRowOf(ctx, { artifactId: a.id, ordinal: t.ordinal, rowIndex: i, cells, candidateId, target: fit.target, doubts: null, at })),
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
      rowsPut: rows.length,
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
  return out;
}

/**
 * The guard of one page write: the file is still read page by page, has room for one more block, and
 * the page holds no block of the other kind (a typed table and model tables never share a page).
 */
function pageGuard(ctx: IngestCtx, a: ArtifactRow, page: number, other: "parser" | "model", rows: number, at: Date): SqliteBatchItem[] {
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
 * guarded on its own ordinal by the unique index). The room for every missing table is checked before
 * the first. A table another tab already wrote is taken as written.
 */
async function insertTables(ctx: IngestCtx, a: ArtifactRow, page: number, pageCount: number, tables: readonly VisionTable[]): Promise<void> {
  const list = tables.slice(0, VISION_PARAMS.tablesPerPage);
  const { lo, hi } = pageOrdinals(page);
  const have = await ctx.db
    .select({ ordinal: ingestBlock.ordinal })
    .from(ingestBlock)
    .where(and(eq(ingestBlock.companyId, ctx.companyId), eq(ingestBlock.artifactId, a.id), sql`${ingestBlock.ordinal} between ${lo} and ${hi}`));
  const taken = new Set(have.map((b) => b.ordinal));
  const missing = list.map((t, i) => ({ t, i })).filter((x) => !taken.has(visionOrdinal(page, x.i)));
  if (missing.length === 0) return;
  const fresh = await loadArtifact(ctx, a.id);
  if (fresh.blockCount + missing.length > INGEST_LIMITS.blocksPerFile) return;
  const learned = await learnedHoles(ctx);
  // The digit check reads the page's text once; missing text only means no marks.
  const bucket = ingestVault();
  const items = bucket ? await loadPageText(bucket, ctx, a, page) : null;
  for (const { t, i } of missing) {
    const at = now();
    const ordinal = visionOrdinal(page, i);
    const statements: SqliteBatchItem[] = [
      ...pageGuard(ctx, a, page, "parser", t.rows.length, at),
      ...(await tableStatements(
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
          vision: { page, table: i, pageCount, rowConfidence: t.rowConfidence, tables: list.length, unseen: unseenCells(t.rows, items) },
        },
        at,
      )),
      auditInsert(ctx, { action: "ingest.vision.page", subjectType: "ingest_artifact", subjectId: a.id, meta: { page, table: i, ordinal, rows: t.rows.length } }),
    ];
    try {
      await guardedBatch(ctx.db, statements);
    } catch (e) {
      if (isBlockUnique(e)) continue;
      if (e instanceof TRPCError && e.code === "CONFLICT") {
        // The guard failed: the file left page reading, filled up, or a person typed this page.
        const now2 = await loadArtifact(ctx, a.id);
        if (now2.readState !== "reading") throw new TRPCError({ code: "BAD_REQUEST", message: VISION_NOT_READING });
        return;
      }
      throw e;
    }
  }
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
  const at = now();
  const ordinal = visionOrdinal(input.page, 0);
  const statements: SqliteBatchItem[] = [
    ...pageGuard(ctx, a, input.page, "model", input.rows.length, at),
    ...(await tableStatements(
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
    )),
    auditInsert(ctx, { action: "ingest.vision.type", subjectType: "ingest_artifact", subjectId: a.id, meta: { page: input.page, ordinal, rows: input.rows.length, columns: input.headers.length } }),
  ];
  try {
    await guardedBatch(ctx.db, statements);
  } catch (e) {
    if (isBlockUnique(e)) throw new TRPCError(MOVED);
    if (isIngestAbort(e) || (e instanceof TRPCError && e.code === "CONFLICT")) {
      const now2 = await loadArtifact(ctx, a.id);
      if (now2.readState !== "reading") throw new TRPCError({ code: "BAD_REQUEST", message: VISION_NOT_READING });
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

export async function visionReadUrl(ctx: IngestCtx, input: { artifactId: string; what: "raw" } | { artifactId: string; what: "page"; page: number }): Promise<VisionReadUrlOut> {
  // The key is built here from the caller's company and the artifact row loaded under it.
  const a = await loadArtifact(ctx, input.artifactId);
  const bucket = needVault();
  const key = input.what === "raw" ? rawKey(ctx.companyId, a.sha256) : pageKey(ctx.companyId, a.sha256, input.page);
  if (!(await bucket.head(key))) throw new TRPCError({ code: "NOT_FOUND", message: "Import file not found" });
  return issueReadTicket(ctx, { companyId: ctx.companyId, userId: ctx.session.user.id, artifactId: a.id, sha256: a.sha256, key, as: input.what });
}
