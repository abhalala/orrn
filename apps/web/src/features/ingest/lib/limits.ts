import type { ArtifactKind, IngestLimits } from "./types";

const MB = 1024 * 1024;

/**
 * Plan A9. The same numbers as `INGEST_LIMITS` on the server, which `ingest.status` also returns. The type is
 * the server's, so a number added there fails the build here until it is copied.
 */
export const DEFAULT_LIMITS: IngestLimits = {
  maxFileBytes: {
    sheet: 20 * MB,
    csv: 50 * MB,
    sql: 100 * MB,
    pdf_text: 25 * MB,
    pdf_scan: 25 * MB,
    image: 10 * MB,
  },
  filesPerUpload: 20,
  blocksPerFile: 50,
  columnsPerBlock: 200,
  rawRowsPerFile: 200_000,
  stagedRowsPerBlock: 50_000,
  openRowsPerPlant: 300_000,
  cellChars: 200,
  rawBytesPerRow: 4096,
  rowsPerPut: 500,
  sampleRowsPerBlock: 200,
  dryRunRowsPerStep: 200,
  rowsPerPage: 100,
  decideRowsPerCall: 200,
  noteChars: 500,
};

export const MAX_FILES = DEFAULT_LIMITS.filesPerUpload;
export const MAX_BLOCKS = DEFAULT_LIMITS.blocksPerFile;
export const MAX_COLUMNS = DEFAULT_LIMITS.columnsPerBlock;
export const MAX_RAW_ROWS = DEFAULT_LIMITS.rawRowsPerFile;
export const CELL_MAX_CHARS = DEFAULT_LIMITS.cellChars;
/** What a cell may weigh on the wire; the server cuts it to `CELL_MAX_CHARS` with a reason code (plan A9). */
export const WIRE_CELL_MAX_CHARS = 2000;
/** `putRows` takes 500 rows at most (plan A1). */
export const ROWS_PER_CALL = DEFAULT_LIMITS.rowsPerPut;
/** `putBlocks` takes 50 blocks at most. */
export const BLOCKS_PER_CALL = DEFAULT_LIMITS.blocksPerFile;
/** `rows.list` pages. */
export const ROWS_PER_PAGE = DEFAULT_LIMITS.rowsPerPage;

/** What the file is, from its name and type. A PDF is `pdf_text` until the reader finds no text layer. */
export type DetectedKind = { kind: ArtifactKind; limitMb: number } | null;

const EXT_KIND: Record<string, ArtifactKind> = {
  xlsx: "sheet", xlsm: "sheet", xls: "sheet",
  csv: "csv", tsv: "csv", txt: "csv",
  sql: "sql", dump: "sql",
  pdf: "pdf_text",
  jpg: "image", jpeg: "image", png: "image", webp: "image", heic: "image",
};

export function limitMbFor(kind: ArtifactKind, limits: IngestLimits = DEFAULT_LIMITS): number {
  return limits.maxFileBytes[kind] / MB;
}

export function detectFileKind(name: string, contentType?: string | null, limits: IngestLimits = DEFAULT_LIMITS): DetectedKind {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  let kind: ArtifactKind | undefined = ext ? EXT_KIND[ext] : undefined;
  if (!kind && contentType) {
    const type = contentType.toLowerCase();
    if (type.includes("spreadsheetml") || type === "application/vnd.ms-excel") kind = "sheet";
    else if (type === "text/csv") kind = "csv";
    else if (type === "application/pdf") kind = "pdf_text";
    else if (type.startsWith("image/")) kind = "image";
  }
  return kind ? { kind, limitMb: limitMbFor(kind, limits) } : null;
}

/** The accept attribute for the file picker. */
export const ACCEPT_FILES =
  ".xlsx,.xlsm,.xls,.csv,.tsv,.sql,.dump,.pdf,.jpg,.jpeg,.png,.webp,.heic," +
  "text/csv,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type FileProblemKey =
  | "ingest.drop.tooBig"
  | "ingest.drop.tooManyRows"
  | "ingest.drop.openLimit"
  | "ingest.drop.wrongType"
  | "ingest.read.failed"
  | "ingest.error.network"
  | "ingest.error.action"
  | "ingest.error.forbidden"
  | "ingest.error.busy"
  | "ingest.error.conflict"
  | "ingest.error.notFound"
  | "ingest.error.load";

/** `key` is a dictionary key and `vars` its variables, ready for `t(key, vars)`. */
export type FileProblem = { key: FileProblemKey; vars?: Record<string, string | number> };

/** Why a picked file is refused before it is read, or null. Unknown types fail later, at reading. */
export function fileSizeProblem(
  file: { name: string; size: number; type?: string },
  limits: IngestLimits = DEFAULT_LIMITS,
): FileProblem | null {
  const found = detectFileKind(file.name, file.type, limits);
  if (!found) return { key: "ingest.drop.wrongType", vars: { name: file.name } };
  if (file.size > found.limitMb * MB) {
    return { key: "ingest.drop.tooBig", vars: { name: file.name, limit: found.limitMb } };
  }
  return null;
}

/** Why a read file is refused (too many rows), or null. */
export function rowCountProblem(name: string, rawRows: number, limits: IngestLimits = DEFAULT_LIMITS): FileProblem | null {
  if (rawRows > limits.rawRowsPerFile) return { key: "ingest.drop.tooManyRows", vars: { name } };
  return null;
}

/** The first `max` picked files; the rest are returned so the screen can say they were left out. */
export function takeFiles<T>(files: readonly T[], max: number = MAX_FILES): { taken: T[]; left: T[] } {
  return { taken: files.slice(0, max), left: files.slice(max) };
}

/** Cuts a cell to the limit (plan A9). Returns the text and whether it was cut. */
export function clipCell(text: string, max: number = CELL_MAX_CHARS): { text: string; cut: boolean } {
  const chars = Array.from(text);
  if (chars.length <= max) return { text, cut: false };
  return { text: chars.slice(0, max).join(""), cut: true };
}

/** Splits a list into runs of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError("chunk size must be a positive integer");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The `putRows` calls for one block: `fromIndex` and the rows of each call, 500 at most. */
export function rowPages(rows: readonly string[][]): { fromIndex: number; rows: string[][] }[] {
  return chunk(rows, ROWS_PER_CALL).map((page, i) => ({ fromIndex: i * ROWS_PER_CALL, rows: page }));
}

/** Rows of every block of a file, to compare against the open-rows limit before sending anything. */
export function totalRows(blocks: readonly { rowCount: number }[]): number {
  return blocks.reduce((sum, b) => sum + b.rowCount, 0);
}

const startsWith = (head: Uint8Array, ...bytes: number[]) => bytes.every((b, i) => head[i] === b);
const isZip = (h: Uint8Array) => startsWith(h, 0x50, 0x4b);
const isOle = (h: Uint8Array) => startsWith(h, 0xd0, 0xcf, 0x11, 0xe0);
const isPdf = (h: Uint8Array) => startsWith(h, 0x25, 0x50, 0x44, 0x46);
const isImage = (h: Uint8Array) =>
  startsWith(h, 0xff, 0xd8, 0xff) ||
  startsWith(h, 0x89, 0x50, 0x4e, 0x47) ||
  (startsWith(h, 0x52, 0x49, 0x46, 0x46) && h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50) ||
  (h[4] === 0x66 && h[5] === 0x74 && h[6] === 0x79 && h[7] === 0x70);

/** True when the first bytes look like text (no control bytes other than tab, newline and return). */
function looksLikeText(head: Uint8Array): boolean {
  for (const b of head) if (b < 9 || (b > 13 && b < 32)) return false;
  return true;
}

/**
 * The kind of a file from its first bytes (plan brief: detect by content). A workbook is a zip (xlsx) or OLE (xls),
 * a PDF starts with `%PDF`, a picture has a known signature. Text is a CSV unless the name said SQL. The name's kind
 * is kept when the bytes agree; a spreadsheet whose bytes are text becomes csv, a csv whose bytes are a workbook
 * becomes a sheet. Null means the bytes do not match what the name says and the file cannot be read as that.
 */
export function sniffKind(head: Uint8Array, declared: ArtifactKind): ArtifactKind | null {
  const workbook = isZip(head) || isOle(head);
  switch (declared) {
    case "sheet":
      if (workbook) return "sheet";
      return !isPdf(head) && !isImage(head) && looksLikeText(head) ? "csv" : null;
    case "csv":
      if (workbook) return "sheet";
      if (isPdf(head)) return "pdf_text";
      return isImage(head) ? null : looksLikeText(head) ? "csv" : null;
    case "sql":
      return !workbook && !isPdf(head) && !isImage(head) && looksLikeText(head) ? "sql" : null;
    case "pdf_text":
    case "pdf_scan":
      return isPdf(head) ? declared : null;
    case "image":
      return isImage(head) ? "image" : null;
  }
}

/** Kinds this release can read in the browser. Photos and scanned pages wait for the vision step. */
export function isReadableKind(kind: ArtifactKind): boolean {
  return kind === "sheet" || kind === "csv" || kind === "sql" || kind === "pdf_text";
}
