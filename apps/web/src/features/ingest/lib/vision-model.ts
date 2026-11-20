import { VISION_PARAMS } from "@orrn/ingest";

import type { Tone, Words } from "./model";
import { isSettled, type BlockVision, type VisionPageView } from "./vision-types";

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
    reason: view.state === "not_read" && view.reason ? { key: `ingest.vision.reason.${view.reason}` } : null,
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
