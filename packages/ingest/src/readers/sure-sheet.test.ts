import { describe, expect, test } from "bun:test";

import { findBlocks, readSheet } from "./blocks";
import { readCsvBlocks } from "./csv";
import { parseSql, sqlTablesToBlocks } from "./sql";
import type { UnsureReason } from "./types";

// PORTAL-RULES-3 section 3: every block says whether the reader is sure, why not, and shows its raw rows.
// Synthetic sheets only. No real plant data.

describe("sure is narrow", () => {
  test("a plain table with the header on the first row is sure", () => {
    const [b] = findBlocks([
      ["Sr", "Party", "Section", "Qty"],
      [1, "Om Metals", "T 4012", 20],
      [2, "Shree Ganesh", "R 2105", 12],
    ]);
    expect(b!.confidence).toBe("sure");
    expect(b!.reasons).toEqual([]);
    expect(b!.hints).toBeNull();
    expect(b!.guess).toEqual({ headerRow: 0, headerRows: 1, firstDataRow: 1, lastDataRow: 2 });
  });

  const cases: [string, unknown[][], UnsureReason][] = [
    ["a title above the header", [["PENDING ORDERS"], ["Sr", "Party", "Qty"], [1, "Om", 5]], "rows_above_header"],
    ["a letterhead in two cells", [["FOURCUBES", "Plant 2"], ["Sr", "Party", "Qty"], [1, "Om", 5]], "first_row_has_no_number"],
    ["a blank header cell", [["Customer", "Contact", "", "City"], ["Om", "Asha", "", "Surat"], ["Ravi", "x", "9", "Pune"]], "header_blank_cell"],
    ["a number in the header", [["Party", "Qty", "2025"], ["Om", 5, 6]], "header_not_text"],
    ["a two-row header", [["Section", "Weight", "", "Rate"], ["", "Min", "Max", ""], ["R2105", 2.1, 2.4, 200]], "two_row_header"],
    ["no number below", [["Name", "City"], ["Asha", "Surat"], ["Ravi", "Pune"]], "no_number_below"],
    ["a data row wider than the header", [["Name", "Qty"], ["Asha", "5", "note"], ["Ravi", "6"]], "row_wider_than_header"],
    ["a word in a number column", [["Party", "Qty"], ["Om", "Cancelled"], ["Asha", 5], ["Ravi", 6]], "word_in_number_column"],
    ["a gap in the rows", [["Party", "Qty"], ["Om", 4], [], ["Asha", 5]], "gap_in_rows"],
    ["a one-cell last row", [["Party", "Qty"], ["Om", 4], ["Prepared by"]], "one_cell_last_row"],
    ["two tables", [["Series", "Section", "Qty"], ["R", "2105", 4], [], ["Party", "Section", "Qty"], ["Om", "2105", 7]], "more_tables"],
  ];
  for (const [label, m, reason] of cases) {
    test(`${label} is unsure (${reason})`, () => {
      const blocks = findBlocks(m as never);
      expect(blocks.length).toBeGreaterThan(0);
      expect(blocks[0]!.confidence).toBe("unsure");
      expect(blocks[0]!.reasons).toContain(reason);
    });
  }
});

describe("preview: the raw rows of the region, before any header", () => {
  test("title, header and rows with their sheet row numbers", () => {
    const m = [[], ["PENDING ORDER LIST"], ["Sr", "Party"], [1, "Om"], [2, "Asha"]];
    const [b] = findBlocks(m);
    expect(b!.preview).toEqual([
      { row: 1, cells: ["PENDING ORDER LIST"] },
      { row: 2, cells: ["Sr", "Party"] },
      { row: 3, cells: ["1", "Om"] },
      { row: 4, cells: ["2", "Asha"] },
    ]);
    expect(b!.guess).toEqual({ headerRow: 2, headerRows: 1, firstDataRow: 3, lastDataRow: 4 });
  });

  test("at most 12 rows, and a two-row header shows both rows as read", () => {
    const m = [["Section", "Weight", "", "Rate"], ["", "Min", "Max", ""], ...Array.from({ length: 20 }, (_, i) => [`R${i}`, 2, 3, 4])];
    const [b] = findBlocks(m);
    expect(b!.preview.length).toBe(12);
    expect(b!.preview[0]).toEqual({ row: 0, cells: ["Section", "Weight", "", "Rate"] });
    expect(b!.preview[1]).toEqual({ row: 1, cells: ["", "Min", "Max", ""] });
  });

  test("the second table's preview starts after the first table", () => {
    const blocks = findBlocks([["Series", "Section", "Qty"], ["R", "2105", 4], [], ["Pending"], ["Party", "Section", "Qty"], ["Om", "2105", 7]]);
    expect(blocks[1]!.preview.map((p) => p.row)).toEqual([3, 4, 5]);
    expect(blocks[1]!.guess.headerRow).toBe(4);
  });

  test("CSV blocks carry the same fields", () => {
    const [b] = readCsvBlocks("Party,Qty\nOm,4\nAsha,5\n");
    expect(b!.confidence).toBe("sure");
    expect(b!.preview[0]).toEqual({ row: 0, cells: ["Party", "Qty"] });
  });

  test("SQL blocks are sure, with the column list as row 0", () => {
    const r = parseSql("CREATE TABLE t (a int, b text);\nINSERT INTO t VALUES (1,'x'),(2,'y');\n");
    const [b] = sqlTablesToBlocks(r.tables);
    expect(b!.confidence).toBe("sure");
    expect(b!.preview).toEqual([
      { row: 0, cells: ["a", "b"] },
      { row: 1, cells: ["1", "x"] },
      { row: 2, cells: ["2", "y"] },
    ]);
  });
});

describe("rows no block takes are reported", () => {
  test("a sheet with no header gives its rows in warnings", () => {
    const r = readSheet([["only one cell"], [], ["another"]]);
    expect(r.blocks).toEqual([]);
    expect(r.warnings).toEqual([
      { code: "not_placed", row: 0 },
      { code: "not_placed", row: 2 },
    ]);
  });
});
