import type { EngineHints, EnginePreviewRow, EngineFollows } from "./reader-engine";
import type { ArtifactKind, BlockInput } from "./types";

/** Messages between the page and `reader.worker.ts` (plan A4). */
export type ReadPhase = "hash" | "open" | "sheet" | "table" | "page" | "blocks";

export type ReadProgress = {
  phase: ReadPhase;
  sheet: string | null;
  rowsRead: number;
  rowsTotal: number | null;
};

/** Hints for the tables of one sheet (a CSV is one unnamed sheet): sorted by header row, every one a table the person named. */
export type SheetHints = { sheetName: string | null; hints: EngineHints[] };

export type WorkerRequest =
  | { id: number; type: "hash"; file: File }
  | { id: number; type: "read"; file: File; kind: ArtifactKind; hints?: SheetHints[] };

/** `putBlocks` takes the region width too; the server's own type does not list it yet, and it ignores what it does not know. */
export type WireBlockInput = Omit<BlockInput, "headers"> & { headers?: string[]; width?: number; follows?: { ordinal: number; gapRows: number } | null };

/** The most warnings and sections the server takes for one table; the true counts go in `warningsTotal` and `sectionsTotal`. */
export const FACTS_MAX = 200;

/** What the header step needs to know about a table that the wire does not carry. */
export type BlockMeta = {
  sheetName: string | null;
  /** The table's place among the tables of its sheet, before a long one is cut into parts. */
  tableIndex: number;
  /** Which part of a table over the row limit this block is (0 for a table in one piece). */
  part: number;
  /** The header the rows were read under, and the hints it was read with (null when guessed), in raw rows. */
  guess: EngineHints;
  hints: EngineHints | null;
  follows: EngineFollows | null;
  /** The raw row numbers shown to a person are `row + rowBase + 1` (a sheet whose first filled row is not row 1). */
  rowBase: number;
  /** The raw rows of the region, as read (the same rows as `input.preview`, kept for the screen). */
  preview: EnginePreviewRow[];
  /** Raw row of the first and of the last data row, for a join with the table below. */
  firstDataRow: number;
  lastDataRow: number;
  /** Blank rows crossed inside the table, and the rows the reader left out and listed (rule 8.1): shown to the person, never hidden. */
  gaps: number;
  /** Title lines the table continued under (round 9). */
  sections: { row: number; text: string }[];
  leftOut: { code: "skipped_repeat_header" | "skipped_title" | "after_last_row"; row: number; text: string }[];
  /** Raw rows above the header that hold text (a title, a month name): they are skipped when the table is joined to the one above. */
  titleRows: number[];
};

/** A block as read: what `putBlocks` sends, plus the rows that follow it in `putRows` and the canonical file. */
export type ReadBlock = { input: WireBlockInput; rows: string[][]; meta?: BlockMeta };

export type ReadFailure =
  | { code: "no_text_layer" }
  | { code: "too_many_rows"; rows: number }
  | { code: "too_many_columns"; sheet: string | null; columns: number }
  | { code: "too_many_blocks"; blocks: number }
  | { code: "unreadable"; detail: string }
  /** A hint that cannot be followed (out of the sheet, overlapping another, in the wrong order). The file is fine. */
  | { code: "hint_error"; detail: string };

export type WorkerResponse =
  | { id: number; type: "progress"; progress: ReadProgress }
  | { id: number; type: "hashed"; sha256: string }
  | { id: number; type: "blocks"; kind: ArtifactKind; blocks: ReadBlock[]; rawRows: number }
  | { id: number; type: "failed"; failure: ReadFailure };
