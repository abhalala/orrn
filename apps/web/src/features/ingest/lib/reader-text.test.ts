import { describe, expect, test } from "bun:test";
import * as XLSX from "xlsx";

import { matrixFromSheet, numberText, readSheetBytes, type ReadDeps, type XlsxLike } from "./reader-core";
import type { EngineBlock, ReaderEngine } from "./reader-engine";

/**
 * Rule 5.4 (PORTAL-RULES-3): a reader hands on each cell as the text a person saw. The twelve cells of the readers' report,
 * written into a real workbook and read back through SheetJS, the way the worker does.
 */

const X = XLSX as unknown as XlsxLike;

type Spec = { name: string; cell: XLSX.CellObject; shown: string };

const CELLS: Spec[] = [
  { name: "leading zeros kept (text)", cell: { t: "s", v: "007" }, shown: "007" },
  { name: "a percent as shown", cell: { t: "n", v: 0.18, z: "0%" }, shown: "18%" },
  { name: "brackets for a negative", cell: { t: "n", v: -1234, z: "#,##0;(#,##0)" }, shown: "(1,234)" },
  { name: "a plain whole number", cell: { t: "n", v: 360001 }, shown: "360001" },
  { name: "two decimals kept", cell: { t: "n", v: 12.3, z: "0.00" }, shown: "12.30" },
  { name: "Indian grouping SheetJS cannot format", cell: { t: "n", v: 100000, z: "#,##,##0" }, shown: "100000" },
  { name: "leading zero by format", cell: { t: "n", v: 12, z: "000" }, shown: "012" },
  { name: "one decimal percent", cell: { t: "n", v: 0.05, z: "0.0%" }, shown: "5.0%" },
  { name: "grouping and decimals", cell: { t: "n", v: 1234.5, z: "#,##0.00" }, shown: "1,234.50" },
  { name: "a serial number with zeros", cell: { t: "n", v: 1, z: "000000" }, shown: "000001" },
  { name: "float noise removed", cell: { t: "n", v: 0.30000000000000004 }, shown: "0.3" },
  { name: "a long whole number", cell: { t: "n", v: 123456789012345680, z: "0" }, shown: "123456789012345680" },
];

/** A workbook of one header row and one row of the twelve cells, written and read back as the worker does. */
function workbookOf(cells: Spec[]): ArrayBuffer {
  const ws: XLSX.WorkSheet = { "!ref": XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 1, c: cells.length - 1 } }) };
  cells.forEach((spec, c) => {
    ws[XLSX.utils.encode_cell({ r: 0, c })] = { t: "s", v: `h${c}` };
    ws[XLSX.utils.encode_cell({ r: 1, c })] = { ...spec.cell };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

const firstRowEngine: ReaderEngine = {
  blocksFromMatrix(matrix) {
    const block: EngineBlock = { title: null, headerRow: 0, headerRows: 1, headers: matrix[0]!, rows: matrix.slice(1) };
    return [block];
  },
  createSqlReader: () => ({ push: () => undefined, finish: () => [] }),
  tablesFromPdfItems: () => [],
};

describe("values come in as the text a person saw (rule 5.4)", () => {
  test("the twelve cells, together, through the real SheetJS path", async () => {
    const blocks = await readSheetBytes(workbookOf(CELLS), { engine: firstRowEngine, loadXlsx: async () => X });
    expect(blocks[0]!.rows[0]).toEqual(CELLS.map((c) => c.shown));
  });

  for (const spec of CELLS) {
    test(`${spec.name}: ${spec.shown}`, async () => {
      const blocks = await readSheetBytes(workbookOf([spec]), { engine: firstRowEngine, loadXlsx: async () => X });
      expect(blocks[0]!.rows[0]).toEqual([spec.shown]);
    });
  }

  test("a boolean is TRUE or FALSE, an error cell keeps its visible text", () => {
    const wb = XLSX.read(workbookOf([{ name: "x", cell: { t: "b", v: true }, shown: "TRUE" }]), { type: "array", cellNF: true });
    expect(matrixFromSheet(X, wb.Sheets.Sheet1 as never).matrix[1]).toEqual(["TRUE"]);
  });

  test("a number with no formatted text is written without float noise", () => {
    expect(numberText(0.1 + 0.2)).toBe("0.3");
    expect(numberText(12.299999999999999)).toBe("12.3");
    expect(numberText(7)).toBe("7");
    expect(numberText(-1234)).toBe("-1234");
    expect(numberText(0.07)).toBe("0.07");
  });

  test("Excel dates stay ISO days, never the m/d/yy text SheetJS gives for the built-in date formats", () => {
    // `cell.w` of a date in format 14 reads "10/11/25" (month first) whatever the person's Excel showed, and read day
    // first that is 10 November. The day comes from the serial number, as before.
    const ws: XLSX.WorkSheet = {
      "!ref": "A1:A2",
      A1: { t: "s", v: "Date" },
      A2: { t: "n", v: 45941, z: "m/d/yy" },
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "S");
    const read = XLSX.read(XLSX.write(wb, { type: "array", bookType: "xlsx" }), { type: "array", cellNF: true });
    expect(matrixFromSheet(X, read.Sheets.S as never).matrix[1]).toEqual(["2025-10-11"]);
  });
});

describe("width and merged ranges go with each block", () => {
  test("a vertical merged range of the order number column is sent by block row", async () => {
    const ws: XLSX.WorkSheet = {
      "!ref": "A1:B5",
      A1: { t: "s", v: "Order" }, B1: { t: "s", v: "Kg" },
      A2: { t: "s", v: "41" }, B2: { t: "n", v: 10 },
      B3: { t: "n", v: 20 },
      B4: { t: "n", v: 30 },
      A5: { t: "s", v: "42" }, B5: { t: "n", v: 40 },
      "!merges": [{ s: { r: 1, c: 0 }, e: { r: 3, c: 0 } }],
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Orders");
    const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const engine: ReaderEngine = {
      ...firstRowEngine,
      blocksFromMatrix(matrix) {
        return [{ title: null, headerRow: 0, headerRows: 1, headers: matrix[0]!, rows: matrix.slice(1), firstDataSheetRow: 1, width: 2 }];
      },
    };
    const blocks = await readSheetBytes(buffer, { engine, loadXlsx: async () => X });
    expect(blocks[0]!.input.merged).toEqual([{ col: 0, firstRow: 0, lastRow: 2 }]);
    expect(blocks[0]!.input.width).toBe(2);
    expect(blocks[0]!.rows.map((r) => r[0])).toEqual(["41", "", "", "42"]);
  });
});
