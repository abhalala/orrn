/**
 * The new-order form as the office types it (FP-OP-02): one block per die, the cut lengths listed
 * under it, Enter in the pieces or kg cell adds the next length under the same die, Shift+Enter a
 * new die block. A block is only a way of entering: what is saved is still one order line per
 * (die, copy, cut length) in the order typed, built by `blockLines`. Every figure the screen shows
 * (pieces, kg, share of the order) is the server's quote for that row; the totals here add up the
 * quotes already on screen and say when some are still on their way.
 */
import type { LengthUnit } from "@orrn/domain";

import { newLine, lineProblems, parseKgG, parsePieces, type LineDraft, type LineProblems } from "./line-model";

export type DieBlock = {
  key: string;
  die: { id: string; label: string } | null;
  /** "any", "copy:<id>" or "tier:<n>" (one choice for the whole die). */
  copy: string;
  rows: LineDraft[];
};

export function newBlock(blockKey: string, rowKey: string): DieBlock {
  return { key: blockKey, die: null, copy: "any", rows: [newLine(rowKey)] };
}

/** The block's rows as order-form lines: each takes the block's die and copy. */
export function blockLines(block: DieBlock): LineDraft[] {
  return block.rows.map((row) => ({ ...row, die: block.die, copy: block.copy }));
}

export function allLines(blocks: readonly DieBlock[]): LineDraft[] {
  return blocks.flatMap(blockLines);
}

/** Change the die (or the copy choice) of a block; a new die resets the copy to "any". */
export function setBlockDie(block: DieBlock, die: DieBlock["die"]): DieBlock {
  return { ...block, die, copy: "any" };
}

/** What a new length row inherits from the row above it: the die's alloy, temper, finish, basis and rate. */
function inherit(from: LineDraft | undefined, key: string): LineDraft {
  const fresh = newLine(key);
  if (!from) return fresh;
  return { ...fresh, alloy: from.alloy, temper: from.temper, finish: from.finish, weightBasis: from.weightBasis, rate: from.rate };
}

/** A blank length row right after `afterKey` (at the end when it is not found). */
export function addRow(block: DieBlock, rowKey: string, afterKey?: string): DieBlock {
  const at = afterKey ? block.rows.findIndex((r) => r.key === afterKey) : -1;
  const index = at < 0 ? block.rows.length : at + 1;
  const row = inherit(at < 0 ? block.rows[block.rows.length - 1] : block.rows[at], rowKey);
  return { ...block, rows: [...block.rows.slice(0, index), row, ...block.rows.slice(index)] };
}

/** Copy a length row (same length, same quantity, same basis) right below it. */
export function duplicateRow(block: DieBlock, key: string, newKey: string): DieBlock {
  const at = block.rows.findIndex((r) => r.key === key);
  if (at < 0) return block;
  const copy: LineDraft = { ...block.rows[at]!, key: newKey };
  delete copy.id;
  delete copy.legacy;
  return { ...block, rows: [...block.rows.slice(0, at + 1), copy, ...block.rows.slice(at + 1)] };
}

/** Remove a length row; the last row of a block is kept (remove the block instead). */
export function removeRow(block: DieBlock, key: string): DieBlock {
  if (block.rows.length <= 1) return block;
  return { ...block, rows: block.rows.filter((r) => r.key !== key) };
}

/** Change the fields every row of the die shares (alloy, temper, finish, weight basis, rate). */
export function patchShared(block: DieBlock, patch: Partial<Pick<LineDraft, "alloy" | "temper" | "finish" | "weightBasis" | "rate">>): DieBlock {
  return { ...block, rows: block.rows.map((r) => ({ ...r, ...patch })) };
}

export function patchRow(block: DieBlock, key: string, patch: Partial<LineDraft>): DieBlock {
  return { ...block, rows: block.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) };
}

export type BlockProblems = { die: boolean; rows: Record<string, LineProblems> };

/** The die problem is the block's; a row only has its own length and quantity problems. */
export function blockProblems(block: DieBlock, unit: LengthUnit): BlockProblems {
  const rows: Record<string, LineProblems> = {};
  for (const line of blockLines(block)) {
    const { die: _die, ...own } = lineProblems(line, unit);
    rows[line.key] = own;
  }
  return { die: block.die == null, rows };
}

export function blocksComplete(blocks: readonly DieBlock[], unit: LengthUnit): boolean {
  return (
    blocks.length > 0 &&
    blocks.every((b) => {
      const p = blockProblems(b, unit);
      return !p.die && Object.values(p.rows).every((r) => Object.keys(r).length === 0);
    })
  );
}

/** Whether the row has a quantity typed (Enter then moves on to a new length). */
export function rowHasQty(row: LineDraft): boolean {
  return row.basis === "pcs" ? parsePieces(row.pcsText) != null : row.basis === "kg" ? parseKgG(row.kgText) != null : false;
}

// ---------------------------------------------------------------------------
// Live totals
// ---------------------------------------------------------------------------

/** One row's quantity as the server quoted it (null while the quote is on its way). */
export type RowQty = { pcs: number; kgG: number } | null;

export type Totals = {
  /** Rows with a quantity. */
  lines: number;
  pcs: number;
  kgG: number;
  /** Some row has a quantity typed but no quote yet: the totals are still moving. */
  pending: boolean;
};

export function totalsOf(qtys: readonly { qty: RowQty; typed: boolean }[]): Totals {
  const out: Totals = { lines: 0, pcs: 0, kgG: 0, pending: false };
  for (const q of qtys) {
    if (q.qty) {
      out.lines += 1;
      out.pcs += q.qty.pcs;
      out.kgG += q.qty.kgG;
    } else if (q.typed) {
      out.pending = true;
    }
  }
  return out;
}

/** A row's share of the whole order's kg as a percent with one decimal ("12.5"), or null without kg. */
export function shareText(rowKgG: number, orderKgG: number): string | null {
  if (!(orderKgG > 0) || !(rowKgG > 0)) return null;
  const tenths = Math.round((rowKgG * 1000) / orderKgG);
  return tenths % 10 === 0 ? String(tenths / 10) : (tenths / 10).toFixed(1);
}

// ---------------------------------------------------------------------------
// Expected date (FP-OP-01, Q8)
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` plus whole days (calendar arithmetic, no time zone involved). */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/** Today as `YYYY-MM-DD` on the plant's clock. */
export function todayYmd(timeZone: string, nowMs: number = Date.now()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(nowMs));
  } catch {
    return new Date(nowMs).toISOString().slice(0, 10);
  }
}

/** The expected date a new order starts with: the order date plus the plant's lead days (default 15). */
export function defaultExpectedDate(orderDate: string, leadDays: number): string {
  return addDaysYmd(orderDate, leadDays);
}
