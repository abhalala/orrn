import { describe, expect, test } from "bun:test";
import * as XLSX from "xlsx";

import { labelled, unlabelled } from "./fixtures";
import { parsePackingListSnapshot } from "./types";
import { buildPackingListXlsxBuffer } from "./xlsx";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function readBack(raw: unknown) {
  const buffer = buildPackingListXlsxBuffer(parsePackingListSnapshot(raw), "PL-0007");
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]!]!;
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: true });
  const headerRow = grid.findIndex((r) => r[0] === "Sr");
  const header = grid[headerRow] as string[];
  const col = (name: string) => header.indexOf(name);
  // Bundle rows: Sr is a number.
  const rows = grid.slice(headerRow + 1).filter((r) => typeof r[0] === "number");
  const cell = (rowIndex: number, name: string) => {
    const addr = XLSX.utils.encode_cell({ r: headerRow + 1 + rowIndex, c: col(name) });
    return ws[addr] as XLSX.CellObject | undefined;
  };
  return { wb, ws, grid, header, headerRow, rows, col, cell };
}

describe("packing list xlsx", () => {
  test("has the plant's columns in order, with a packing group column", () => {
    const { header } = readBack(unlabelled);
    expect(header).toEqual([
      "Sr",
      "Bundle no",
      "Item",
      "Packing group",
      "Weight kg",
      "Cut length ft",
      "Cut length in",
      "Pcs",
      "kg/12ft",
      "Weight range /12'",
    ]);
  });

  test("weight, length, pieces and kg/12ft cells are numbers, not text", () => {
    const { rows, header, headerRow, ws } = readBack(unlabelled);
    expect(rows).toHaveLength(3);
    const numeric = ["Weight kg", "Cut length ft", "Cut length in", "Pcs", "kg/12ft", "Weight range /12'"];
    // Every bundle row, read straight from the cells (t === "n").
    for (let r = headerRow + 1; r < headerRow + 1 + 6; r++) {
      const sr = ws[XLSX.utils.encode_cell({ r, c: 0 })] as XLSX.CellObject | undefined;
      if (!sr || sr.t !== "n") continue;
      for (const name of numeric) {
        const c = ws[XLSX.utils.encode_cell({ r, c: header.indexOf(name) })] as XLSX.CellObject;
        expect(c.t).toBe("n");
        expect(typeof c.v).toBe("number");
      }
    }
    const first = rows.find((r) => r[1] === "26I4086")!;
    expect(first[4]).toBe(50.455);
    expect(first[5]).toBe(12);
    expect(first[6]).toBe(144);
    expect(first[8]).toBe(2.522);
    expect(first[9]).toBe(2.5);
  });

  test("the group column never contains a UUID or a packing session id", () => {
    for (const raw of [unlabelled, labelled]) {
      const { grid, col, headerRow } = readBack(raw);
      for (const row of grid.slice(headerRow + 1)) {
        const value = String(row[col("Packing group")] ?? "");
        expect(value).not.toMatch(UUID);
        expect(value).not.toMatch(/dev-group/i);
      }
    }
    const { rows, col } = readBack(labelled);
    expect(rows.map((r) => r[col("Packing group")])).toEqual(["A", "A", "B"]);
  });

  test("header dates are ISO days and totals read N bundles and X kg; no total length anywhere", () => {
    const { grid } = readBack(unlabelled);
    const label = (name: string) => grid.find((r) => r[0] === name)?.[1];
    expect(label("Packing list")).toBe("PL-0007");
    expect(label("Dispatch")).toBe("D-0042");
    expect(label("Customer")).toBe("Shivam Aluminium, Bhavnagar");
    expect(label("Date")).toBe("2026-10-03");
    expect(label("Ship date")).toBe("2026-10-04");
    expect(label("Bundles")).toBe(3);
    expect(label("Total kg")).toBe(152.971);
    const text = JSON.stringify(grid).toLowerCase();
    expect(text).not.toContain("length m");
    expect(text).not.toContain("total length");
  });

  test("each group ends with a subtotal and the sheet ends with the grand total", () => {
    const { grid, headerRow, col } = readBack(labelled);
    const body = grid.slice(headerRow + 1).filter((r) => r.some((v) => v !== undefined && v !== null && v !== ""));
    const totals = body.filter((r) => typeof r[0] !== "number");
    expect(totals.map((r) => r[col("Item")])).toEqual(["Total A", "Total B", "Total"]);
    const grand = totals[totals.length - 1]!;
    expect(grand[col("Bundle no")]).toBe("3 bundles");
    expect(grand[col("Weight kg")]).toBe(152.971);
    expect(grand[col("Pcs")]).toBe(65);
  });
});
