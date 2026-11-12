import { describe, expect, test } from "bun:test";
import Papa from "papaparse";
import * as XLSX from "xlsx";

import {
  cellText, finishBlocks, matrixFromSheet, readCsvText, readFileBlocks, readPdfBytes, readSheetBytes, readSqlChunks,
  READ_LIMITS, ReadStop, sampleRows, sha256OfBuffer, textChunks, type PdfLike, type ReadDeps, type XlsxLike,
} from "./reader-core";
import type { EngineBlock, ReaderEngine } from "./reader-engine";
import type { ReadProgress } from "./reader-protocol";

/** A first-row-header engine: enough to test the reader around it. The real one is lane C's. */
const fakeEngine: ReaderEngine = {
  blocksFromMatrix(matrix) {
    const rows = matrix.filter((r) => r.some((c) => c.trim() !== ""));
    if (rows.length === 0) return [];
    const block: EngineBlock = { title: null, headerRow: 0, headerRows: 1, headers: rows[0]!, rows: rows.slice(1) };
    return [block];
  },
  createSqlReader() {
    let text = "";
    return {
      push: (chunk) => void (text += chunk),
      finish: () =>
        text.split("\n\n").filter(Boolean).map((t, i) => {
          const lines = t.trim().split("\n");
          return { table: `t${i}`, headers: lines[0]!.split(","), rows: lines.slice(1).map((l) => l.split(",")) };
        }),
    };
  },
  tablesFromPdfItems(items) {
    const rows = new Map<number, string[]>();
    for (const it of items) rows.set(it.y, [...(rows.get(it.y) ?? []), it.text]);
    const lines = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, cells]) => cells);
    return lines.length > 0 ? [{ title: null, headers: lines[0]!, rows: lines.slice(1) }] : [];
  },
};

const xlsxLike = XLSX as unknown as XlsxLike;
const deps = (over: Partial<ReadDeps> = {}): ReadDeps => ({
  engine: fakeEngine,
  loadXlsx: async () => xlsxLike,
  loadPapa: async () => Papa as never,
  ...over,
});

function workbook(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { type: "array", bookType: "xlsx", cellDates: true }) as ArrayBuffer;
}

describe("cell text", () => {
  test("no number formatting, booleans as TRUE and FALSE, dates as ISO days", () => {
    expect(cellText(12.5)).toBe("12.5");
    expect(cellText(null)).toBe("");
    expect(cellText(true)).toBe("TRUE");
    expect(cellText(new Date(Date.UTC(2025, 9, 31)))).toBe("2025-10-31");
  });
});

describe("sample rows", () => {
  const rows = Array.from({ length: 1000 }, (_, i) => [String(i)]);
  test("a small block is all of its rows", () => {
    expect(sampleRows(rows.slice(0, 150))).toHaveLength(150);
  });
  test("a big block is the first 100 and 100 spread over the rest", () => {
    const s = sampleRows(rows);
    expect(s).toHaveLength(200);
    expect(s[0]![0]).toBe("0");
    expect(s[99]![0]).toBe("99");
    const spread = s.slice(100).map((r) => Number(r[0]));
    expect(spread[0]!).toBeGreaterThanOrEqual(100);
    expect(spread[99]!).toBeGreaterThan(900);
    expect([...spread].sort((a, b) => a - b)).toEqual(spread);
  });
});

describe("sheets", () => {
  test("every sheet is read, Excel dates come out as ISO text and are named as date columns", async () => {
    const buffer = workbook({
      Baki: [["Party", "Date", "Kg"], ["Shree", new Date(Date.UTC(2025, 9, 31)), 120.5], ["Om", new Date(Date.UTC(2025, 10, 2)), 80]],
      Other: [["Code"], ["R2105"]],
    });
    const progress: ReadProgress[] = [];
    const blocks = await readSheetBytes(buffer, deps({ onProgress: (p) => progress.push(p) }));
    expect(blocks.map((b) => b.input.sheetName)).toEqual(["Baki", "Other"]);
    expect(blocks.map((b) => b.input.ordinal)).toEqual([0, 1]);
    expect(blocks[0]!.input.headers).toEqual(["Party", "Date", "Kg"]);
    expect(blocks[0]!.rows).toEqual([["Shree", "2025-10-31", "120.5"], ["Om", "2025-11-02", "80"]]);
    expect(blocks[0]!.input.rowCount).toBe(2);
    expect(blocks[0]!.input.dateColumns).toEqual([1]);
    expect(blocks[1]!.input.dateColumns).toBeUndefined();
    expect(progress.map((p) => p.phase)).toEqual(["open", "sheet", "sheet", "blocks"]);
    expect(progress[1]).toMatchObject({ sheet: "Baki", rowsRead: 3, rowsTotal: 3 });
  });

  test("an empty sheet gives no block", () => {
    const X = xlsxLike;
    expect(matrixFromSheet(X, {})).toEqual({ matrix: [], dateColumns: [] });
  });

  test("a sheet past the raw row limit stops the read with the count", async () => {
    const buffer = workbook({ A: [["h"], ["1"], ["2"], ["3"]] });
    await expect(readSheetBytes(buffer, deps({ limits: { ...READ_LIMITS, maxRawRows: 3 } }))).rejects.toMatchObject({
      failure: { code: "too_many_rows", rows: 4 },
    });
  });

  test("a cancelled read stops between sheets", async () => {
    const buffer = workbook({ A: [["h"], ["1"]], B: [["h"], ["2"]] });
    await expect(readSheetBytes(buffer, deps({ isCancelled: () => true }))).rejects.toBeInstanceOf(ReadStop);
  });
});

describe("csv", () => {
  test("rows come out as text, a BOM is dropped, quotes and commas survive", async () => {
    const text = "﻿Series,Section code,Name\nR,2105,\"Angle, 25x25\"\nR,2106,Tee\n";
    const blocks = await readCsvText(text, deps());
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.input.headers).toEqual(["Series", "Section code", "Name"]);
    expect(blocks[0]!.rows[0]).toEqual(["R", "2105", "Angle, 25x25"]);
    expect(blocks[0]!.input.sheetName).toBeNull();
  });
  test("the raw row limit applies", async () => {
    await expect(readCsvText("a\n1\n2\n3\n", deps({ limits: { ...READ_LIMITS, maxRawRows: 2 } }))).rejects.toMatchObject({
      failure: { code: "too_many_rows" },
    });
  });
});

describe("limits on blocks", () => {
  const block = (cols: number, rows: number): EngineBlock => ({
    title: null, headerRow: 0, headerRows: 1,
    headers: Array.from({ length: cols }, (_, i) => `h${i}`),
    rows: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => `${r}-${c}`)),
  });

  test("200 columns pass, 201 stop the read", () => {
    expect(finishBlocks([{ sheetName: "A", block: block(200, 1) }])).toHaveLength(1);
    expect(() => finishBlocks([{ sheetName: "A", block: block(201, 1) }])).toThrow(ReadStop);
    try {
      finishBlocks([{ sheetName: "A", block: block(201, 1) }]);
    } catch (e) {
      expect((e as ReadStop).failure).toEqual({ code: "too_many_columns", sheet: "A", columns: 201 });
    }
  });

  test("50 blocks pass, 51 stop the read", () => {
    const pieces = (n: number) => Array.from({ length: n }, (_, i) => ({ sheetName: `S${i}`, block: block(2, 1) }));
    expect(finishBlocks(pieces(50))).toHaveLength(50);
    expect(() => finishBlocks(pieces(51))).toThrow(ReadStop);
  });

  test("a block over the staged rows limit is split into parts with the same headers", () => {
    const out = finishBlocks([{ sheetName: "Bundles", block: block(2, 7) }], { ...READ_LIMITS, maxRowsPerBlock: 3 });
    expect(out.map((b) => b.input.rowCount)).toEqual([3, 3, 1]);
    expect(out.map((b) => b.input.ordinal)).toEqual([0, 1, 2]);
    expect(out.map((b) => b.input.title)).toEqual(["Bundles (1/3)", "Bundles (2/3)", "Bundles (3/3)"]);
    expect(out[1]!.rows[0]).toEqual(["3-0", "3-1"]);
    expect(out.every((b) => b.input.headers.join() === "h0,h1")).toBe(true);
  });

  test("a part count that pushes past 50 blocks stops the read", () => {
    expect(() => finishBlocks([{ sheetName: "A", block: block(1, 60) }], { ...READ_LIMITS, maxRowsPerBlock: 1 })).toThrow(ReadStop);
  });

  test("cells keep up to 2,000 characters for the server to cut at 200, with its reason code", () => {
    const b: EngineBlock = { title: null, headerRow: 0, headerRows: 1, headers: ["x".repeat(2500)], rows: [["y".repeat(250), "z".repeat(2500)]] };
    const out = finishBlocks([{ sheetName: null, block: b }]);
    expect(out[0]!.input.headers[0]).toHaveLength(2000);
    expect(out[0]!.rows[0]![0]).toHaveLength(250);
    expect(out[0]!.rows[0]![1]).toHaveLength(2000);
  });

  test("the sample is bounded at 200 rows", () => {
    const out = finishBlocks([{ sheetName: null, block: block(2, 1000) }]);
    expect(out[0]!.input.sample).toHaveLength(200);
    expect(out[0]!.input.rowCount).toBe(1000);
  });
});

describe("sql dumps", () => {
  test("text arrives in chunks and tables come back in order", async () => {
    async function* chunks() {
      yield "id,name\n1,Shree\n";
      yield "2,Om\n\nid,code\n9,R";
      yield "2105\n";
    }
    const progress: ReadProgress[] = [];
    const blocks = await readSqlChunks(chunks(), 100, deps({ onProgress: (p) => progress.push(p) }));
    expect(blocks.map((b) => [b.input.sheetName, b.input.headers, b.rows])).toEqual([
      ["t0", ["id", "name"], [["1", "Shree"], ["2", "Om"]]],
      ["t1", ["id", "code"], [["9", "R2105"]]],
    ]);
    expect(progress).toHaveLength(3);
    expect(progress[2]!.phase).toBe("table");
  });

  test("a Blob streams as decoded text", async () => {
    const out: string[] = [];
    for await (const c of textChunks(new Blob(["id,name\n1,Å\n"]))) out.push(c);
    expect(out.join("")).toBe("id,name\n1,Å\n");
  });
});

describe("pdf", () => {
  const pdfWith = (pages: { str: string; x: number; y: number }[][]): PdfLike => ({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: pages.length,
        getPage: async (n: number) => ({
          getTextContent: async () => ({
            items: pages[n - 1]!.map((p) => ({ str: p.str, transform: [1, 0, 0, 1, p.x, p.y], width: 10, height: 8 })).concat([{ hasEOL: true } as never]),
          }),
        }),
      }),
    }),
  });

  test("text items go to the engine with their positions", async () => {
    const pdf = pdfWith([[
      { str: "Section code", x: 10, y: 100 }, { str: "Quantity", x: 80, y: 100 },
      { str: "R2105", x: 10, y: 80 }, { str: "12", x: 80, y: 80 },
    ]]);
    const blocks = await readPdfBytes(new ArrayBuffer(8), deps({ loadPdf: async () => pdf }));
    expect(blocks[0]!.input.headers).toEqual(["Section code", "Quantity"]);
    expect(blocks[0]!.rows).toEqual([["R2105", "12"]]);
  });

  test("a PDF with no text layer is its own failure", async () => {
    const pdf = pdfWith([[{ str: " ", x: 1, y: 1 }]]);
    await expect(readPdfBytes(new ArrayBuffer(8), deps({ loadPdf: async () => pdf }))).rejects.toMatchObject({ failure: { code: "no_text_layer" } });
  });
});

describe("dispatch by kind", () => {
  const fileOf = (text: string) => new File([text], "x");
  test("csv, sql and image", async () => {
    expect((await readFileBlocks(fileOf("a,b\n1,2\n"), "csv", deps()))[0]!.rows).toEqual([["1", "2"]]);
    expect((await readFileBlocks(fileOf("id,n\n1,a\n"), "sql", deps()))[0]!.input.sheetName).toBe("t0");
    await expect(readFileBlocks(fileOf(""), "image", deps())).rejects.toBeInstanceOf(ReadStop);
  });
});

describe("sha256", () => {
  test("hex of the bytes", async () => {
    expect(await sha256OfBuffer(new TextEncoder().encode("abc").buffer as ArrayBuffer)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

/** Review E1, E4, E5, E6, E14: cells and sheets as Excel really stores them. */
describe("review: sheet cells", () => {
  const X = xlsxLike;
  const serial1900 = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
  const sheetOf = (cells: Record<string, unknown>, ref: string) => ({ "!ref": ref, ...cells }) as never;

  test("E1: an error cell keeps its visible text, never the numeric error code", () => {
    const sheet = sheetOf({ A1: { t: "s", v: "Weight" }, A2: { t: "e", v: 42, w: "#N/A" }, A3: { t: "e", v: 7, w: "#DIV/0!" }, A4: { t: "e", v: 15 } }, "A1:A4");
    const { matrix, dateColumns } = matrixFromSheet(X, sheet);
    expect(matrix).toEqual([["Weight"], ["#N/A"], ["#DIV/0!"], ["#ERROR"]]);
    expect(dateColumns).toEqual([]);
  });

  test("E4: a 1904 workbook reads the same day, not four years and a day off", () => {
    const wanted = serial1900(2026, 11, 10);
    const sheet = sheetOf({ A1: { t: "n", v: wanted - 1462, z: "yyyy-mm-dd" } }, "A1:A1");
    expect(matrixFromSheet(X, sheet, { date1904: true }).matrix).toEqual([["2026-11-10"]]);
    const plain = sheetOf({ A1: { t: "n", v: wanted, z: "yyyy-mm-dd" } }, "A1:A1");
    expect(matrixFromSheet(X, plain).matrix).toEqual([["2026-11-10"]]);
  });

  test("E4: a time-only cell is a time, not 1900-01-00, and does not make a date column", () => {
    const sheet = sheetOf({ A1: { t: "n", v: 0.5, z: "h:mm" }, A2: { t: "n", v: 0.75, z: "h:mm" } }, "A1:A2");
    const out = matrixFromSheet(X, sheet);
    expect(out.matrix).toEqual([["12:00"], ["18:00"]]);
    expect(out.dateColumns).toEqual([]);
  });

  test("E4: a date with a time keeps its day", () => {
    const sheet = sheetOf({ A1: { t: "n", v: serial1900(2026, 11, 10) + 0.6, z: "yyyy-mm-dd hh:mm" } }, "A1:A1");
    expect(matrixFromSheet(X, sheet).matrix).toEqual([["2026-11-10"]]);
  });

  test("E4: the workbook's date system reaches the cells through readSheetBytes", async () => {
    const sheet = sheetOf({ A1: { t: "s", v: "Date" }, A2: { t: "n", v: serial1900(2026, 11, 10) - 1462, z: "yyyy-mm-dd" } }, "A1:A2");
    const fake = {
      ...XLSX,
      read: () => ({ SheetNames: ["S"], Sheets: { S: sheet }, Workbook: { WBProps: { date1904: true } } }),
    } as unknown as XlsxLike;
    const blocks = await readSheetBytes(new ArrayBuffer(8), deps({ loadXlsx: async () => fake }));
    expect(blocks[0]!.rows[0]![0]).toBe("2026-11-10");
  });

  test("E5: a block of 150,000 rows is counted without spreading it into Math.max", () => {
    const rows = Array.from({ length: 150_000 }, (_, i) => [String(i), "x"]);
    const out = finishBlocks([{ sheetName: "Big", block: { title: null, headerRow: 0, headerRows: 1, headers: ["a", "b"], rows } }]);
    expect(out.map((b) => b.input.rowCount)).toEqual([50_000, 50_000, 50_000]);
  });

  test("E6: a range stretched by formatting is not walked cell by cell", () => {
    const sheet = sheetOf({ A1: { t: "s", v: "h" }, A2: { t: "s", v: "1" } }, "A1:XFD1048576");
    const out = matrixFromSheet(X, sheet);
    expect(out.matrix).toEqual([["h"], ["1"]]);
  });

  test("E6: real cells past the caps stop the read before a matrix is built", () => {
    const wide = sheetOf({ A1: { t: "s", v: "h" }, IA1: { t: "s", v: "x" } }, "A1:IA1");
    expect(() => matrixFromSheet(X, wide, { maxColumns: 200 })).toThrow(ReadStop);
    const tall = sheetOf({ A1: { t: "s", v: "h" }, A5: { t: "s", v: "x" } }, "A1:A5");
    try {
      matrixFromSheet(X, tall, { maxRows: 4 });
      throw new Error("no stop");
    } catch (e) {
      expect((e as ReadStop).failure).toEqual({ code: "too_many_rows", rows: 5 });
    }
  });

  test("E6: a sheet with no cells gives no matrix even with a big range", () => {
    expect(matrixFromSheet(X, sheetOf({}, "A1:XFD1048576"))).toEqual({ matrix: [], dateColumns: [] });
  });

  // Rule 5.4 (PORTAL-RULES-3): a cell is the text a person saw, so a number shown as 12.6 is 12.6. The old assertion kept the
  // stored 12.64 under a "0.0" format; see reader-text.test.ts for the twelve cells of the rule.
  test("E14: a number shown with leading zeros keeps them; another number is the text its format shows", () => {
    const sheet = sheetOf({
      A1: { t: "n", v: 7, z: "0000", w: "0007" },
      A2: { t: "n", v: 12.64, z: "0.0", w: "12.6" },
    }, "A1:A2");
    expect(matrixFromSheet(X, sheet).matrix).toEqual([["0007"], ["12.6"]]);
  });
});

describe("review: E5 source guard", () => {
  test("reader-core never spreads a row list into a call (V8 and Safari throw past about 100,000 arguments)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./reader-core.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/Math\.(max|min)\(\s*[^)]*\.\.\./);
  });
});
