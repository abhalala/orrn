import { VISION_PARAMS } from "@orrn/ingest";

import type { Tone, Words } from "./model";
import type { BlockVision, VisionPageView } from "./vision-types";

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

/**
 * One page of the list. A page not read offers "Read again" when the server says it may be tried again (a day cap that
 * reset), and always "Type this page" and "Skip this page". A page with an answer still due is read by "Carry on reading".
 */
export function visionPageRow(view: VisionPageView, canUpload: boolean): VisionPageRow {
  const actions: VisionPageAction[] = [];
  if (canUpload && view.state === "not_read") {
    if (view.canRetry) actions.push("readAgain");
    actions.push("type", "skip");
  }
  return {
    page: view.page,
    name: { key: "ingest.vision.pageName", vars: { page: view.page } },
    state: { key: `ingest.vision.state.${view.state}` },
    tone: STATE_TONE[view.state],
    reason: view.state === "not_read" && view.reason ? { key: `ingest.vision.reason.${view.reason}` } : null,
    tables: view.state === "read" || view.state === "typed" ? { key: "ingest.vision.tables", vars: { count: view.tables } } : null,
    actions,
  };
}

/** What the file page offers for the pass as a whole. */
export function visionFileActions(pages: readonly VisionPageView[], settled: boolean): { carryOn: boolean; needsBytes: boolean; finish: boolean } {
  const waiting = pages.some((p) => p.state === "waiting");
  const due = pages.some((p) => p.state === "ready");
  return { carryOn: waiting || due, needsBytes: waiting, finish: settled };
}

export type VisionCell = { text: string; blank: boolean };

export type VisionRowView = {
  id: string;
  rowIndex: number;
  /** The row's number as a person counts (1 is the first row under the column names). */
  n: number;
  low: boolean;
  confidence: number | null;
  cells: VisionCell[];
};

/**
 * The rows of a table read from a page, rows the model was not sure of first (lowest first, as `lowRows` lists them),
 * then the rest in page order. A cell with no text is marked blank. `rows` are the staged rows (their `raw` cells), so a
 * cell a person fixed shows as fixed, and a rate the viewer may not see stays masked as the server sent it.
 */
export function visionRows(
  rows: readonly { id: string; rowIndex: number; raw: readonly string[] }[],
  vision: Pick<BlockVision, "lowRows" | "rowConfidence">,
  width: number,
): VisionRowView[] {
  const lowOrder = new Map<number, number>();
  vision.lowRows.forEach((rowIndex, i) => lowOrder.set(rowIndex, i));
  const low = (rowIndex: number) => lowOrder.has(rowIndex) || (vision.rowConfidence[rowIndex] ?? 1) < VISION_PARAMS.lowConfidence;
  const views = rows.map((row): VisionRowView => {
    const cells: VisionCell[] = Array.from({ length: Math.max(width, row.raw.length) }, (_, col) => {
      const text = row.raw[col] ?? "";
      return { text, blank: text.trim() === "" };
    });
    return { id: row.id, rowIndex: row.rowIndex, n: row.rowIndex + 1, low: low(row.rowIndex), confidence: vision.rowConfidence[row.rowIndex] ?? null, cells };
  });
  const rank = (v: VisionRowView) => (lowOrder.has(v.rowIndex) ? lowOrder.get(v.rowIndex)! : v.low ? lowOrder.size : Number.POSITIVE_INFINITY);
  return views.sort((a, b) => {
    if (a.low !== b.low) return a.low ? -1 : 1;
    if (a.low && b.low) return rank(a) - rank(b) || (a.confidence ?? 1) - (b.confidence ?? 1) || a.rowIndex - b.rowIndex;
    return a.rowIndex - b.rowIndex;
  });
}

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
