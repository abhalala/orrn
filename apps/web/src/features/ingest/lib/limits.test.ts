import { describe, expect, test } from "bun:test";

import {
  ACCEPT_FILES, DEFAULT_LIMITS, BLOCKS_PER_CALL, chunk, clipCell, detectFileKind, fileSizeProblem, MAX_FILES, ROWS_PER_CALL,
  rowCountProblem, rowPages, takeFiles, totalRows,
} from "./limits";

const mb = (n: number) => n * 1024 * 1024;

describe("file kinds", () => {
  test("by extension", () => {
    expect(detectFileKind("Baki Oct-25.xlsx")?.kind).toBe("sheet");
    expect(detectFileKind("dies.CSV")?.kind).toBe("csv");
    expect(detectFileKind("fcms_dump.sql")?.kind).toBe("sql");
    expect(detectFileKind("PL-1.pdf")?.kind).toBe("pdf_text");
    expect(detectFileKind("register.JPG")?.kind).toBe("image");
    expect(detectFileKind("notes.docx")).toBeNull();
  });
  test("by content type when the name has no known extension", () => {
    expect(detectFileKind("export", "text/csv")?.kind).toBe("csv");
    expect(detectFileKind("export", "application/pdf")?.kind).toBe("pdf_text");
    expect(detectFileKind("export", "application/octet-stream")).toBeNull();
  });
  test("each kind has its MB limit from plan A9", () => {
    expect(detectFileKind("a.xlsx")?.limitMb).toBe(20);
    expect(detectFileKind("a.csv")?.limitMb).toBe(50);
    expect(detectFileKind("a.sql")?.limitMb).toBe(100);
    expect(detectFileKind("a.pdf")?.limitMb).toBe(25);
    expect(detectFileKind("a.png")?.limitMb).toBe(10);
  });
  test("the default limits are the plan A9 numbers", () => {
    expect(DEFAULT_LIMITS.filesPerUpload).toBe(20);
    expect(DEFAULT_LIMITS.blocksPerFile).toBe(50);
    expect(DEFAULT_LIMITS.columnsPerBlock).toBe(200);
    expect(DEFAULT_LIMITS.rawRowsPerFile).toBe(200_000);
    expect(DEFAULT_LIMITS.stagedRowsPerBlock).toBe(50_000);
    expect(DEFAULT_LIMITS.openRowsPerPlant).toBe(300_000);
    expect(DEFAULT_LIMITS.cellChars).toBe(200);
    expect(DEFAULT_LIMITS.rowsPerPut).toBe(500);
  });
  test("accept string names every extension", () => {
    for (const ext of [".xlsx", ".csv", ".sql", ".pdf", ".jpg"]) expect(ACCEPT_FILES).toContain(ext);
  });
});

describe("file size problems", () => {
  test("at the limit passes, one byte over is refused with name and limit", () => {
    expect(fileSizeProblem({ name: "a.xlsx", size: mb(20) })).toBeNull();
    expect(fileSizeProblem({ name: "a.xlsx", size: mb(20) + 1 })).toEqual({
      key: "ingest.drop.tooBig",
      vars: { name: "a.xlsx", limit: 20 },
    });
    expect(fileSizeProblem({ name: "a.csv", size: mb(50) })).toBeNull();
    expect(fileSizeProblem({ name: "a.sql", size: mb(100) + 1 })?.vars?.limit).toBe(100);
    expect(fileSizeProblem({ name: "a.pdf", size: mb(25) + 1 })?.vars?.limit).toBe(25);
    expect(fileSizeProblem({ name: "a.jpg", size: mb(10) + 1 })?.vars?.limit).toBe(10);
  });
  test("an unknown type cannot be read", () => {
    expect(fileSizeProblem({ name: "a.docx", size: 10 })).toEqual({ key: "ingest.read.failed" });
  });
  test("raw rows: 200,000 passes, one more is refused", () => {
    expect(rowCountProblem("a.csv", 200_000)).toBeNull();
    expect(rowCountProblem("a.csv", 200_001)).toEqual({ key: "ingest.drop.tooManyRows", vars: { name: "a.csv" } });
  });
});

describe("files per upload", () => {
  test("keeps 20 and reports the rest", () => {
    const files = Array.from({ length: 23 }, (_, i) => i);
    const { taken, left } = takeFiles(files);
    expect(taken).toHaveLength(MAX_FILES);
    expect(left).toEqual([20, 21, 22]);
  });
});

describe("cells and chunks", () => {
  test("a cell is cut at 200 characters, counted in characters not bytes", () => {
    expect(clipCell("a".repeat(200))).toEqual({ text: "a".repeat(200), cut: false });
    const long = clipCell("a".repeat(201));
    expect(long.cut).toBe(true);
    expect(long.text).toHaveLength(200);
    const hindi = "क".repeat(201);
    expect(Array.from(clipCell(hindi).text)).toHaveLength(200);
  });
  test("chunk splits and rejects a bad size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    expect(() => chunk([1], 0)).toThrow(RangeError);
  });
  test("row pages are 500 rows with their start index", () => {
    const rows = Array.from({ length: 1201 }, (_, i) => [String(i)]);
    const pages = rowPages(rows);
    expect(pages.map((p) => [p.fromIndex, p.rows.length])).toEqual([[0, 500], [500, 500], [1000, 201]]);
    expect(ROWS_PER_CALL).toBe(500);
    expect(rowPages([])).toEqual([]);
  });
  test("block calls hold 50 and totals add up", () => {
    expect(BLOCKS_PER_CALL).toBe(50);
    expect(totalRows([{ rowCount: 10 }, { rowCount: 5 }])).toBe(15);
  });
});
