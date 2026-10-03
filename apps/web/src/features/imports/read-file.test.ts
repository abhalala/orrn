import { describe, expect, test } from "bun:test";

import { fileKind, readCsvText, rowsFromMatrix } from "./read-file";

describe("fileKind", () => {
  test("by extension, case-insensitive", () => {
    expect(fileKind("stock.CSV")).toBe("csv");
    expect(fileKind("dies.xlsx")).toBe("excel");
    expect(fileKind("old.xls")).toBe("excel");
    expect(fileKind("notes.json")).toBeNull();
    expect(fileKind("noext")).toBeNull();
  });
});

describe("rowsFromMatrix (Excel)", () => {
  test("first row is the header; numbers become plain text; row numbers follow the sheet", () => {
    const res = rowsFromMatrix(
      [
        ["Die series", " Weight (kg) ", "Length (mm)"],
        ["1000", 45.5, 3658],
        ["", "", ""],
        ["2000", 12, true],
      ],
      0,
    );
    expect(res.firstDataRow).toBe(2);
    expect(res.rows).toEqual([
      { "Die series": "1000", "Weight (kg)": "45.5", "Length (mm)": "3658" },
      { "Die series": "", "Weight (kg)": "", "Length (mm)": "" },
      { "Die series": "2000", "Weight (kg)": "12", "Length (mm)": "TRUE" },
    ]);
  });

  test("leading blank rows and a sheet that starts lower move the row numbers; trailing blanks are dropped", () => {
    const res = rowsFromMatrix([[], ["", ""], ["Name", "Phone"], ["Shree", 9825012345], ["", ""], []], 3);
    // Range starts on sheet row 4; two blank rows; header on sheet row 6; data from row 7.
    expect(res.firstDataRow).toBe(7);
    expect(res.rows).toEqual([{ Name: "Shree", Phone: "9825012345" }]);
  });

  test("blank headers are skipped and repeated headers are kept apart", () => {
    const res = rowsFromMatrix([["Name", "", "Name"], ["a", "b", "c"]], 0);
    expect(res.rows).toEqual([{ Name: "a", "Name 2": "c" }]);
  });

  test("an empty sheet has no rows", () => {
    expect(rowsFromMatrix([], 0).rows).toEqual([]);
  });
});

describe("readCsvText", () => {
  test("keeps blank lines in the middle so row numbers match the sheet; strips the BOM", async () => {
    const res = await readCsvText("﻿Die series,Weight (kg)\r\n1000,45.5\r\n\r\n2000,\"1,234.5\"\r\n\r\n");
    expect(res.firstDataRow).toBe(2);
    expect(res.rows).toEqual([
      { "Die series": "1000", "Weight (kg)": "45.5" },
      { "Die series": "", "Weight (kg)": "" },
      { "Die series": "2000", "Weight (kg)": "1,234.5" },
    ]);
  });
});
