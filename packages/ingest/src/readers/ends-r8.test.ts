import { describe, expect, test } from "bun:test";

import { chooseHeaderInSheet } from "../header";
import { readSheet, type SheetRead } from "./blocks";
import { readCsv } from "./csv";
import type { ReadBlock } from "./types";

// Round 8, rule 8.1: what happens after a blank row. Once the header is known, each column has a kind from the rows
// read so far (number, date or text). After blank rows the next row is a repeat of the header (left out, listed, the
// table goes on), a single text cell (left out, listed, the table goes on), data that fits the kinds (the table goes
// on, `gaps` counts the blank rows), or anything else (the table ends before the blank rows). A table of text columns
// only never goes on across a blank row; the part below follows it and `follows.continues` offers the join.
// The cases are the checker's round 7 reproductions (r7i, r7d, r7j, r7c, r7e, sgen7). Synthetic rows only.

const H = ["Party", "Order No", "PO", "Section", "Cut Length", "Pcs", "Kg", "Rate"];
const row = (i: number, po = true, rate = true) => ["Om " + i, String(100 + i), po ? "PO" + i : "", "T40" + (10 + (i % 9)), "3660", "12", String(300 + i), rate ? "245" : ""];
const rowsOf = (from: number, n: number) => Array.from({ length: n }, (_, i) => row(from + i));
const SUB = [["Vehicle", "Driver", "Kg"], ["GJ03AB1234", "Ramesh", "4520"], ["GJ03AB9876", "Suresh", "3100"]];
const filled = (rs: readonly (readonly string[])[]) => rs.filter((r) => r.some((c) => c !== ""));
const hintedOf = (r: SheetRead) => r.blocks.find((b) => b.hints !== null)!;
const listed = (b: ReadBlock, code: string) => b.warnings.filter((w) => w.code === code);

/** Every filled cell is in a header, a data row, a title, or a listed row; and no row is read twice. */
function accounted(m: readonly (readonly string[])[], r: SheetRead): boolean {
  const seen = new Map<number, number>();
  const add = (k: number) => seen.set(k, (seen.get(k) ?? 0) + 1);
  for (const b of r.blocks) {
    for (let k = b.guess.headerRow; k < b.guess.headerRow + b.headerRows; k++) add(k); // title rows are kept_as_title warnings
    b.rows.forEach((x, i) => x.some((c) => c !== "") && add(b.firstDataSheetRow + i));
    for (const w of b.warnings) add(w.row);
  }
  for (const w of r.warnings) add(w.row);
  return m.every((x, i) => (x.some((c) => c !== "") ? seen.get(i) === 1 : !seen.has(i) || x.every((c) => c === "")));
}

describe("8.1: after a blank row", () => {
  // r7i: an order book, a blank row, more order rows, blank rows, maybe a title, then a dispatch table.
  for (const [n1, n2, gap2, title] of [[10, 3, 1, false], [10, 3, 1, true], [10, 30, 2, false], [5, 10, 1, true], [10, 10, 3, true]] as [number, number, number, boolean][]) {
    test(`r7i: ${n1} rows, a blank, ${n2} rows, ${gap2} blank, ${title ? "a title, " : ""}a Vehicle table: one order book and a second block`, () => {
      const m = [H, ...rowsOf(0, n1), [], ...rowsOf(n1, n2), ...Array.from({ length: gap2 }, () => []), ...(title ? [["Dispatch"]] : []), ...SUB];
      for (const r of [readSheet(m, { hints: [{ headerRow: 0 }] }), readSheet(m)]) {
        const book = r.blocks[0]!;
        expect(filled(book.rows).length).toBe(n1 + n2);
        expect(book.gaps).toBe(1);
        expect(r.blocks.length).toBe(2);
        const sub = r.blocks[1]!;
        expect(sub.headers).toEqual(SUB[0]!);
        expect(sub.rows.length).toBe(2);
        expect(sub.title).toBe(title ? "Dispatch" : null);
        expect(sub.follows).toMatchObject({ block: 0, gapRows: gap2, continues: false });
        expect(accounted(m, r)).toBe(true);
      }
    });
  }

  test("r7c, r7e: a register of 2,400 rows with its header again after a blank row every 40 rows is one block", () => {
    for (const page of [false, true]) {
      const m = [H, ...Array.from({ length: 60 }, (_, p) => [...rowsOf(p * 40, 40), [], ...(page ? [["Page " + (p + 2)]] : []), H]).flat().slice(0, page ? -3 : -2)];
      for (const r of [readSheet(m, { hints: [{ headerRow: 0 }] }), readSheet(m)]) {
        expect(r.blocks.length).toBe(1);
        const b = r.blocks[0]!;
        expect(filled(b.rows).length).toBe(2400);
        expect(listed(b, "skipped_repeat_header").length).toBe(59);
        expect(listed(b, "skipped_title").length).toBe(page ? 59 : 0);
        expect(b.gaps).toBe(59);
        expect(accounted(m, r)).toBe(true);
      }
    }
  });

  test("r7c: 500 rows with a blank row after each, and a one-cell remark after a blank, are one block", () => {
    const every = [H, ...rowsOf(0, 500).flatMap((x) => [x, []])];
    expect(readSheet(every, { hints: [{ headerRow: 0 }] }).blocks.map((b) => [filled(b.rows).length, b.gaps])).toEqual([[500, 499]]);
    const remarks = [H, ...rowsOf(0, 500).flatMap((x, i) => [x, [], ["remark " + i], []])];
    const r = readSheet(remarks, { hints: [{ headerRow: 0 }] });
    expect(r.blocks.length).toBe(1);
    expect(filled(r.blocks[0]!.rows).length).toBe(500);
    // The last remark has no row after it: the table does not go on, so it is a note of the block, not a title.
    expect(listed(r.blocks[0]!, "skipped_title").length).toBe(499);
    expect(accounted(remarks, r)).toBe(true);
  });

  test("a December line is left out and listed with its text, and the table goes on", () => {
    const m = [H, ...rowsOf(0, 10), [], ["December"], ...rowsOf(10, 10)];
    for (const r of [readSheet(m, { hints: [{ headerRow: 0 }] }), readSheet(m)]) {
      expect(r.blocks.length).toBe(1);
      const b = r.blocks[0]!;
      expect(filled(b.rows).length).toBe(20);
      expect(listed(b, "skipped_title")).toEqual([{ code: "skipped_title", row: 12, text: "December" }]);
      // Row i of rows is still sheet row firstDataSheetRow + i: the skipped row is blank in rows.
      expect(b.rows[11]!.every((c) => c === "")).toBe(true);
      expect(b.gaps).toBe(1);
    }
  });

  test("a repeated header is listed with its text; a second month in the same layout joins the first", () => {
    const m = [H, ...rowsOf(0, 10), [], [], ["December"], H, ...rowsOf(10, 4)];
    const b = readSheet(m, { hints: [{ headerRow: 0 }] }).blocks;
    expect(b.length).toBe(1);
    expect(filled(b[0]!.rows).length).toBe(14);
    expect(listed(b[0]!, "skipped_title")).toEqual([{ code: "skipped_title", row: 13, text: "December" }]);
    expect(listed(b[0]!, "skipped_repeat_header")).toEqual([{ code: "skipped_repeat_header", row: 14, text: H.join(" ") }]);
    expect(b[0]!.gaps).toBe(2);
  });

  test("a repeat in another case still counts as the header (r7a C3)", () => {
    const m = [H, ...rowsOf(0, 3), [], H.map((c) => c.toUpperCase()), ...rowsOf(3, 3)];
    expect(readSheet(m).blocks.map((b) => filled(b.rows).length)).toEqual([6]);
  });

  test("r7d: rows that fit the kinds go on, whatever their count of filled cells", () => {
    const lacksPo = [H, ...Array.from({ length: 10 }, (_, i) => row(i, false)), [], ...rowsOf(10, 10)];
    const lacksRate = [H, ...rowsOf(0, 10), [], row(10, true, false), ...rowsOf(11, 9)];
    for (const m of [lacksPo, lacksRate]) {
      const r = readSheet(m, { hints: [{ headerRow: 0 }] });
      expect(r.blocks.map((b) => filled(b.rows).length)).toEqual([20]);
    }
  });

  test("r7j: a blank spacer under the header, a units row then a blank, two rows then a blank", () => {
    const t = rowsOf(0, 12);
    const units = ["", "", "", "", "mm", "pcs", "kg", "Rs"];
    for (const m of [[H, [], ...t], [H, units, [], ...t], [H, ...t.slice(0, 2), [], ...t.slice(2)]]) {
      for (const r of [readSheet(m, { hints: [{ headerRow: 0 }] }), readSheet(m)]) {
        expect(r.blocks.length).toBe(1);
        expect(filled(r.blocks[0]!.rows).filter((x) => /^\d+$/.test(x[1] ?? "")).length).toBe(12);
      }
    }
  });

  test("text in a number column after a blank row is another table's header, with or without a hint", () => {
    const m = [["Date", "Party", "Kg"], ["2025-01-02", "Om", "21.05"], ["2025-01-03", "Mehta", "12.50"], [], ["Party", "Order No", "Pcs"], ["Om", "308", "218"]];
    for (const r of [readSheet(m, { hints: [{ headerRow: 0 }] }), readSheet(m)]) {
      expect(r.blocks.map((b) => [b.guess.headerRow, b.rows.length])).toEqual([[0, 2], [4, 1]]);
      expect(r.blocks[1]!.follows).toMatchObject({ block: 0, gapRows: 1, continues: false });
    }
  });

  test("a table of text columns only never goes on by itself; the part below follows it and is offered as its rows", () => {
    const head = ["Firm", "Contact", "Place"];
    const m = [head, ["Om", "Ramesh", "Rajkot"], ["Mehta", "Suresh", "Morbi"], [], ["Kamal", "Mahesh", "Surat"], ["Zenith", "Naresh", "Rajkot"]];
    for (const r of [readSheet(m, { hints: [{ headerRow: 0 }] }), readSheet(m)]) {
      expect(r.blocks.map((b) => [b.guess.headerRow, b.rows.length])).toEqual([[0, 2], [4, 1]]);
      expect(r.blocks[1]!.follows).toEqual({ block: 0, gapRows: 1, continues: true });
      expect(r.blocks[0]!.gaps).toBe(0);
    }
    // The join is the person's: the upper hint with the lower block's last row reads it exactly.
    const j = readSheet(m, { hints: [{ headerRow: 0, lastDataRow: 5 }] });
    expect(j.blocks.length).toBe(1);
    expect(filled(j.blocks[0]!.rows).length).toBe(4);
    expect(j.blocks[0]!.gaps).toBe(1);
  });

  test("the offer that is left: same columns, by normalised names, for a block that was not joined", () => {
    const head = ["Firm", "Lot", "Grade", "Kg"];
    const lot = (i: number) => ["Om", "L" + i, "6063", String(10 + i)];
    const m = [head, lot(1), lot(2), lot(3), [], ["Note"], [], head.map((c) => c.toUpperCase()), lot(4), lot(5)];
    const r = readSheet(m, { hints: [{ headerRow: 0, lastDataRow: 3 }] });
    expect(r.blocks.length).toBe(2);
    const c = chooseHeaderInSheet(r.blocks, 1);
    expect(c.kind).toBe("ask");
    if (c.kind === "ask") {
      expect(c.sameColumnsAsAbove).toBe(true);
      expect("continuesAbove" in c).toBe(false);
    }
  });

  test("a hint with a last row still reads exactly, across blank rows and repeats, with skipRows", () => {
    const m = [H, ...rowsOf(0, 5), [], ["December"], H, ...rowsOf(5, 5), [], ...SUB];
    const r = readSheet(m, { hints: [{ headerRow: 0, lastDataRow: 13, skipRows: [7, 8] }] });
    const b = hintedOf(r);
    expect(b.rows.length).toBe(13);
    expect(listed(b, "skipped_by_hint").map((w) => w.row)).toEqual([7, 8]);
    expect(listed(b, "skipped_title")).toEqual([]);
    expect(b.gaps).toBe(1);
    expect(r.blocks.length).toBe(2);
  });

  test("a stray note at the end is a note of the block above, never a sheet warning", () => {
    const m = [H, ...rowsOf(0, 5), [], [], ["checked"]];
    for (const r of [readSheet(m, { hints: [{ headerRow: 0 }] }), readSheet(m)]) {
      expect(r.blocks.length).toBe(1);
      expect(r.blocks[0]!.warnings).toEqual([{ code: "after_last_row", row: 8 }]);
      expect(r.warnings).toEqual([]);
    }
  });

  test("CSV reads the same way", () => {
    const m = [H, ...rowsOf(0, 4), [], ["December"], ...rowsOf(4, 4), [], ...SUB];
    const r = readCsv(m.map((x) => x.join(",")).join("\n"), { hints: [{ headerRow: 0 }] });
    expect(r.blocks.map((b) => [b.guess.headerRow, filled(b.rows).length, b.gaps])).toEqual([[0, 8, 1], [12, 2, 0]]);
    expect(listed(r.blocks[0]!, "skipped_title")).toEqual([{ code: "skipped_title", row: 6, text: "December" }]);
  });
});
