/**
 * The slice of a block that goes to the model (plan B6, "Sample").
 *
 * All headers; up to 30 rows: the first 15, 10 spread evenly over the rest, and 5 chosen for
 * the most distinct cell kinds. Cells are cut to 80 characters. The rows together are at most
 * 24,000 characters of JSON. A block with more than 200 columns is refused.
 */

export const MAX_COLUMNS = 200;
export const MAX_SAMPLE_ROWS = 30;
export const FIRST_ROWS = 15;
export const SPREAD_ROWS = 10;
export const DISTINCT_ROWS = 5;
export const CELL_CHARS = 80;
export const SAMPLE_CHARS = 24_000;

export type SampleBlock = {
  headers: string[];
  kinds: string[];
};

export type Sample = {
  headers: string[];
  kinds: string[];
  rows: string[][];
  /** Index of each sampled row in the input rows, ascending. */
  rowIndexes: number[];
};

export type SampleRefusal = { refused: "too_many_columns" | "sample_too_large" };

const NUMBER = /^[-+]?\(?[\d.,]+\)?\s*%?$/;
const DATE = /^\d{1,4}[-/. ]\d{1,2}[-/. ]\d{1,4}$/;

/** A coarse cell kind, used only to choose rows that differ from each other. */
export function cellClass(cell: string): "blank" | "number" | "date" | "text" {
  const t = cell.trim();
  if (t === "") return "blank";
  if (DATE.test(t)) return "date";
  if (NUMBER.test(t)) return "number";
  return "text";
}

function cut(cell: string): string {
  return cell.length > CELL_CHARS ? cell.slice(0, CELL_CHARS) : cell;
}

/** Row indexes in priority order: the first 15, then the spread rows, then the distinct rows. */
export function pickRowIndexes(rows: string[][]): number[] {
  const n = rows.length;
  if (n <= MAX_SAMPLE_ROWS) return rows.map((_, i) => i);
  const chosen: number[] = [];
  const taken = new Set<number>();
  const take = (i: number) => {
    if (!taken.has(i)) {
      taken.add(i);
      chosen.push(i);
    }
  };
  for (let i = 0; i < FIRST_ROWS; i++) take(i);
  const poolSize = n - FIRST_ROWS;
  for (let k = 0; k < SPREAD_ROWS; k++) take(FIRST_ROWS + Math.floor(((k + 0.5) * poolSize) / SPREAD_ROWS));

  const seen = new Set<string>();
  const mark = (i: number) => rows[i]!.forEach((c, col) => seen.add(`${col}:${cellClass(c)}`));
  chosen.forEach(mark);
  for (let k = 0; k < DISTINCT_ROWS; k++) {
    let best = -1;
    let bestGain = -1;
    for (let i = FIRST_ROWS; i < n; i++) {
      if (taken.has(i)) continue;
      let gain = 0;
      rows[i]!.forEach((c, col) => {
        if (!seen.has(`${col}:${cellClass(c)}`)) gain++;
      });
      if (gain > bestGain) {
        bestGain = gain;
        best = i;
      }
    }
    if (best < 0) break;
    take(best);
    mark(best);
  }
  return chosen;
}

export function buildSample(block: SampleBlock, rows: string[][]): Sample | SampleRefusal {
  if (block.headers.length > MAX_COLUMNS) return { refused: "too_many_columns" };
  const priority = pickRowIndexes(rows);
  const cutRows = new Map<number, string[]>();
  for (const i of priority) cutRows.set(i, rows[i]!.map(cut));

  // Drop the lowest-priority rows until the rows fit.
  let keep = priority.length;
  const size = (k: number) => JSON.stringify(priority.slice(0, k).map((i) => cutRows.get(i))).length;
  while (keep > 0 && size(keep) > SAMPLE_CHARS) keep--;
  if (keep === 0 && priority.length > 0) return { refused: "sample_too_large" };

  const rowIndexes = priority.slice(0, keep).sort((a, b) => a - b);
  return {
    headers: block.headers,
    kinds: block.kinds,
    rows: rowIndexes.map((i) => cutRows.get(i)!),
    rowIndexes,
  };
}
