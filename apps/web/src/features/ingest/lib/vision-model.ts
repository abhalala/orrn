import { VISION_PARAMS } from "@orrn/ingest";

import type { Tone, Words } from "./model";
import { canFinishOf, isSettled, type BlockVision, type VisionPageView, type VisionPagesOut } from "./vision-types";

/**
 * View models of the vision read: the file page's page list and the review's rows read from a page. The screens draw
 * what these return.
 */

export type VisionPageAction = "readAgain" | "type" | "skip";

export type VisionPageRow = {
  page: number;
  name: Words;
  state: Words;
  tone: Tone;
  /** Why a page was not read, in plain words. */
  reason: Words | null;
  /** "2 tables" for a page read. */
  tables: Words | null;
  /** "1 of 3 parts read" while a dense page is read in bands (section 11.3). */
  bands: Words | null;
  actions: VisionPageAction[];
};

const STATE_TONE: Record<VisionPageView["state"], Tone> = {
  waiting: "neutral",
  ready: "info",
  read: "success",
  not_read: "warning",
  typed: "success",
  skipped: "neutral",
};

/** A page waiting on its bands (section 11.3): the server asked for bands, or some bands are not read yet. */
export function waitsOnBands(view: VisionPageView): boolean {
  return view.next === "band" || (view.bands != null && view.bands.read < view.bands.total);
}

/**
 * One page of the list. A page not read offers "Read again" when the server says it may be tried again (a day cap that
 * reset), and always "Type this page" and "Skip this page". A page waiting on its bands also offers type and skip, so a
 * page the browser cannot cut never holds the file open. A page with an answer still due is read by "Carry on reading".
 */
export function visionPageRow(view: VisionPageView, canUpload: boolean): VisionPageRow {
  const actions: VisionPageAction[] = [];
  if (canUpload && view.state === "not_read") {
    if (view.canRetry) actions.push("readAgain");
    actions.push("type", "skip");
  } else if (canUpload && !isSettled(view.state) && waitsOnBands(view)) {
    actions.push("type", "skip");
  }
  const bands = view.bands && view.bands.total > 0 && !isSettled(view.state) ? view.bands : null;
  return {
    page: view.page,
    name: { key: "ingest.vision.pageName", vars: { page: view.page } },
    state: { key: `ingest.vision.state.${view.state}` },
    tone: STATE_TONE[view.state],
    // A page waiting to be cut says why it is not read whole: too many lines for one read.
    reason:
      view.state === "not_read" && view.reason
        ? { key: `ingest.vision.reason.${view.reason}` }
        : view.next === "band" && !isSettled(view.state)
          ? { key: "ingest.vision.reason.too_long" }
          : null,
    tables: view.state === "read" || view.state === "typed" ? { key: "ingest.vision.tables", vars: { count: view.tables } } : null,
    bands: bands ? { key: "ingest.vision.bands", vars: { read: bands.read, total: bands.total } } : null,
    actions,
  };
}

/** What the file page offers for the pass as a whole. */
export function visionFileActions(pages: readonly VisionPageView[], settled: boolean): { carryOn: boolean; needsBytes: boolean; finish: boolean } {
  const waiting = pages.some((p) => p.state === "waiting");
  const due = pages.some((p) => p.state === "ready");
  // A page the server wants in bands is cut from the file's pixels, so it needs the bytes too.
  const toCut = pages.some((p) => p.next === "band");
  return { carryOn: waiting || due, needsBytes: waiting || toCut, finish: settled };
}

/**
 * A page the model can still take, today or after a day cap: no image yet, an answer due, or stopped by a day cap. The
 * server's own rule (`openForModel` in `lib/ingest/vision.ts`): a page only a person can settle never holds the next batch.
 */
export function openForModel(v: VisionPageView): boolean {
  if (isSettled(v.state)) return false;
  if (v.state === "waiting" || v.state === "ready") return v.next !== "band";
  return v.state === "not_read" && (v.reason === "cap_day_calls" || v.reason === "cap_day_cost");
}

/** Whole page numbers as runs: [1, 2, 3, 5] is [[1, 3], [5, 5]]. */
export function pageRanges(pages: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of [...new Set(pages)].sort((a, b) => a - b)) {
    const last = out.at(-1);
    if (last && p === last[1] + 1) last[1] = p;
    else out.push([p, p]);
  }
  return out;
}

/** What the file page says and offers about batches (contract section 12). */
export type VisionBatchView = {
  /** Read or typed pages as runs, for "Pages read: 1 to 12, 14 to 30." (`readRangesWords`); empty before any is read. */
  readRanges: [number, number][];
  /** "Pages 31 to 100 of 100 are not read yet.", null when every page is planned. */
  restLine: Words | null;
  /** The day cap stopped the read at this page; "Read next pages" carries on from it. */
  dayCapLine: Words | null;
  /** The file holds the most tables one file may. */
  fullLine: Words | null;
  /** "Read next pages", with the pages it reads; null when there is nothing for the model to read. */
  readNext: { from: number; to: number; needsBytes: boolean; note: Words } | null;
  /** "Finish without pages 31 to 100": every planned page is settled and pages past the plan are left. */
  finishEarly: { label: Words; note: Words } | null;
  /** "Skip the rest and finish": a full file with pages still open. */
  skipRest: boolean;
};

/**
 * The batch state of a file being read. `batchSize` is the plant's pages per batch (`ingest.status`). "Read next pages"
 * carries on from the first page the model can still take (after a day cap, the same day if the caps allow, else the
 * next plant day); with none, it plans the next batch, which needs the file's bytes to draw the new pages.
 */
export function visionBatch(out: VisionPagesOut, batchSize: number): VisionBatchView {
  const done = out.pages.filter((p) => p.state === "read" || p.state === "typed").map((p) => p.page);
  const ranges = pageRanges(done);
  const rest = out.planned < out.pageCount && !out.restNotRead ? { from: out.planned + 1, to: out.pageCount } : null;
  const open = out.pages.filter(openForModel).sort((a, b) => a.page - b.page);
  const capped = open.find((p) => p.state === "not_read") ?? null;
  const full = out.full === true;
  let readNext: VisionBatchView["readNext"] = null;
  if (capped) {
    // A day cap stopped the read: carry on from the capped page through the rest of the plan. Pages already stored
    // need no bytes; a page with no image does.
    readNext = { from: capped.page, to: out.planned, needsBytes: open.some((p) => p.state === "waiting"), note: { key: "ingest.vision.readNextNote", vars: { from: capped.page, to: out.planned } } };
  } else if (open.length === 0 && !full && out.planned < out.pageCount && !out.pages.some((p) => !isSettled(p.state) && p.next === "band")) {
    // A page waiting to be cut goes first ("Carry on reading" draws its bands); then the next batch.
    const from = out.planned + 1;
    const to = Math.min(out.pageCount, out.planned + Math.max(1, Math.floor(batchSize)));
    readNext = { from, to, needsBytes: true, note: { key: "ingest.vision.readNextNote", vars: { from, to } } };
  }
  const settledNow = out.pages.every((p) => isSettled(p.state));
  const finishEarly =
    settledNow && out.settled && rest && !canFinishOf(out)
      ? { label: { key: "ingest.vision.finishEarly", vars: { from: rest.from, to: rest.to } }, note: { key: "ingest.vision.finishEarlyNote", vars: { from: rest.from, to: rest.to } } }
      : null;
  return {
    readRanges: ranges,
    restLine: rest ? { key: "ingest.vision.restLine", vars: { from: rest.from, to: rest.to, total: out.pageCount } } : null,
    dayCapLine: capped ? { key: capped.reason === "cap_day_cost" ? "ingest.vision.dayCostLine" : "ingest.vision.dayCallsLine", vars: { page: capped.page } } : null,
    fullLine: full ? { key: "ingest.vision.fullLine", vars: { max: VISION_TABLES_PER_FILE } } : null,
    readNext,
    finishEarly,
    skipRest: full && !settledNow,
  };
}

/** "Pages read: 1 to 12, 14, 16 to 30." in the reader's language: `say` is the screen's word function. */
export function readRangesWords(ranges: readonly [number, number][], say: (key: string, vars?: Record<string, string | number>) => string): string | null {
  if (ranges.length === 0) return null;
  const list = ranges.map(([from, to]) => (from === to ? say("ingest.vision.rangeOne", { page: from }) : say("ingest.vision.range", { from, to }))).join(", ");
  return say("ingest.vision.readRanges", { ranges: list });
}

/** `INGEST_LIMITS.blocksPerFile` on the server: the most tables one file may hold. */
export const VISION_TABLES_PER_FILE = 50;

export type VisionCell = {
  text: string;
  blank: boolean;
  /** Section 11.5: a digit run of this cell is not in the PDF's text layer. */
  unseen: boolean;
};

export type VisionRowView = {
  id: string;
  rowIndex: number;
  /** The row's number as a person counts (1 is the first row under the column names). */
  n: number;
  /** A cell of this row holds digits that are not in the PDF's text. */
  unseen: boolean;
  low: boolean;
  confidence: number | null;
  cells: VisionCell[];
};

/**
 * The rows of a table read from a page, in the order of contract section 11.5: rows with a cell whose digits are not in
 * the PDF's text first (page order), then rows the model rated under `lowConfidence` (lowest first, as `lowRows` lists
 * them), then the rest in page order. Confidence only orders the list; it says nothing about a row being right. A cell
 * with no text is marked blank. `rows` are the staged rows (their `raw` cells), so a cell a person fixed shows as fixed,
 * and a rate the viewer may not see stays masked as the server sent it. Cell text is data and is only ever shown as text.
 */
export function visionRows(
  rows: readonly { id: string; rowIndex: number; raw: readonly string[] }[],
  vision: Pick<BlockVision, "lowRows" | "rowConfidence" | "unseen">,
  width: number,
): VisionRowView[] {
  const lowOrder = new Map<number, number>();
  vision.lowRows.forEach((rowIndex, i) => lowOrder.set(rowIndex, i));
  const unseen = new Map<number, Set<number>>();
  for (const mark of vision.unseen ?? []) {
    if (!Array.isArray(mark) || mark.length !== 2) continue;
    const [row, col] = mark;
    if (!unseen.has(row)) unseen.set(row, new Set());
    unseen.get(row)!.add(col);
  }
  const low = (rowIndex: number) => lowOrder.has(rowIndex) || (vision.rowConfidence[rowIndex] ?? 1) < VISION_PARAMS.lowConfidence;
  const views = rows.map((row): VisionRowView => {
    const marked = unseen.get(row.rowIndex);
    const cells: VisionCell[] = Array.from({ length: Math.max(width, row.raw.length) }, (_, col) => {
      const text = row.raw[col] ?? "";
      return { text, blank: text.trim() === "", unseen: marked?.has(col) === true };
    });
    return {
      id: row.id, rowIndex: row.rowIndex, n: row.rowIndex + 1, unseen: cells.some((c) => c.unseen), low: low(row.rowIndex),
      confidence: vision.rowConfidence[row.rowIndex] ?? null, cells,
    };
  });
  const group = (v: VisionRowView) => (v.unseen ? 0 : v.low ? 1 : 2);
  const rank = (v: VisionRowView) => (lowOrder.has(v.rowIndex) ? lowOrder.get(v.rowIndex)! : lowOrder.size);
  return views.sort((a, b) => {
    const g = group(a) - group(b);
    if (g !== 0) return g;
    if (group(a) === 1) return rank(a) - rank(b) || (a.confidence ?? 1) - (b.confidence ?? 1) || a.rowIndex - b.rowIndex;
    return a.rowIndex - b.rowIndex;
  });
}

/** What `vision.typePage` takes (contract section 7): 1 to 50 column names, 1 to 500 rows. */
export const TYPED_MAX_COLUMNS = 50;
export const TYPED_MAX_ROWS = 500;

/** The typed table of "Type this page": column names and rows, checked before it goes. */
export type TypedTable = { title: string; headers: string[]; rows: string[][] };

export function emptyTypedTable(): TypedTable {
  return { title: "", headers: ["", ""], rows: [["", ""]] };
}

/** Rows with any text, cut to the column count. Problems are dictionary keys. */
export function typedTableProblems(table: TypedTable): { ok: boolean; problems: string[]; headers: string[]; rows: string[][] } {
  const headers = table.headers.map((h) => h.trim());
  const rows = table.rows.map((r) => headers.map((_, i) => (r[i] ?? "").trim())).filter((r) => r.some((c) => c !== ""));
  const problems: string[] = [];
  if (headers.length === 0 || headers.some((h) => h === "")) problems.push("ingest.vision.type.needHeader");
  if (rows.length === 0) problems.push("ingest.vision.type.needRow");
  return { ok: problems.length === 0, problems, headers, rows };
}
