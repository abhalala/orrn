/**
 * Fingerprint of a block (plan B3): normalized headers, their hash and the cell kinds. Pure; the browser and the
 * server run the same code, so the server never trusts a browser fit.
 */
import { inferKind } from "./cells";
import { sha256Hex } from "./hash";
import type { BlockInput, BlockShape, CellKind } from "./recipe";

const UNIT_TOKENS: [RegExp, string][] = [
  [/(?<![a-z0-9])(?:kgs|kg\.|kilos?)(?![a-z0-9])/g, "kg"],
  [/(?<![a-z0-9])(?:mtrs?|meters?|metres?)(?![a-z0-9])/g, "m"],
  [/(?<![a-z0-9])(?:feet|foot)(?![a-z0-9])/g, "ft"],
  [/(?<![a-z0-9])(?:nos|no\.|pcs\.)(?![a-z0-9])/g, "pcs"],
  [/(?<![a-z0-9])(?:rs\.|rs|inr)(?![a-z0-9])|₹/g, "inr"],
];

/** NFKC and lower case, unit tokens canonical, every run outside [a-z0-9/] one space, trimmed. Blank stays "". */
export function normalizeHeader(h: string): string {
  let t = h.normalize("NFKC").toLowerCase();
  t = t.replace(/'/g, " ft ");
  for (const [re, to] of UNIT_TOKENS) t = t.replace(re, (m) => (m === "₹" ? " inr " : to));
  return t.replace(/[^a-z0-9/]+/g, " ").trim();
}

/**
 * How many leading columns count. Trailing columns with no header and no cell under them are dropped.
 */
export function usedWidth(headers: readonly string[], rows: readonly (readonly string[])[]): number {
  let width = headers.length;
  const colHasData = (c: number) => rows.some((r) => (r[c] ?? "").trim() !== "");
  while (width > 0 && headers[width - 1]!.trim() === "" && !colHasData(width - 1)) width--;
  return width;
}

/** Normalized headers of the first `width` columns; a blank one becomes `_` plus its index. */
export function normalizeHeaders(headers: readonly string[], width = headers.length): string[] {
  const out: string[] = [];
  for (let i = 0; i < width; i++) {
    const n = normalizeHeader(headers[i] ?? "");
    out.push(n === "" ? `_${i}` : n);
  }
  return out;
}

/** Hex SHA-256 of `"v1|"` plus the normalized headers joined by U+001F. Order matters. */
export function headerKey(normalized: readonly string[]): string {
  return sha256Hex(`v1|${normalized.join("\u001f")}`);
}

export function inferKinds(rows: readonly (readonly string[])[], width: number): CellKind[] {
  const kinds: CellKind[] = [];
  for (let c = 0; c < width; c++) kinds.push(inferKind(rows.map((r) => r[c] ?? "")));
  return kinds;
}

export type FingerprintInput = {
  headers: readonly string[];
  /** Data rows (any order; a sample is fine). */
  rows: readonly (readonly string[])[];
  headerRow?: number;
  headerRows?: number;
};

export type Fingerprint = BlockShape & { normalized: string[] };

export function fingerprint(input: FingerprintInput): Fingerprint {
  const width = usedWidth(input.headers, input.rows);
  const headers = input.headers.slice(0, width);
  const normalized = normalizeHeaders(headers, width);
  return {
    headers,
    normalized,
    columnCount: width,
    kinds: inferKinds(input.rows, width),
    headerKey: headerKey(normalized),
    headerRow: input.headerRow ?? 0,
    headerRows: input.headerRows ?? 1,
  };
}

export const SAMPLE_ROWS = 20;
export const SAMPLE_CELL_CHARS = 80;

/** The block as `artifact.putBlocks` takes it. `rows` is every data row; only a sample leaves with it. */
export function describeBlock(
  block: {
    sheetName: string | null;
    title: string | null;
    headerRow: number;
    headerRows: number;
    headers: readonly string[];
    rows: readonly (readonly string[])[];
  },
  ordinal: number,
): BlockInput {
  const fp = fingerprint(block);
  return {
    ordinal,
    sheetName: block.sheetName,
    title: block.title,
    headerRow: block.headerRow,
    headerRows: block.headerRows,
    headers: fp.headers,
    kinds: fp.kinds,
    headerKey: fp.headerKey,
    columnCount: fp.columnCount,
    rowCount: block.rows.length,
    sample: block.rows.slice(0, SAMPLE_ROWS).map((r) => fp.headers.map((_, i) => [...(r[i] ?? "")].slice(0, SAMPLE_CELL_CHARS).join(""))),
  };
}
