import { describe, expect, test } from "bun:test";
import * as XLSX from "xlsx";

import { buildStockOnOrderHtml } from "./html";
import { stockOnOrderFileName, stockOnOrderModel, type StockOnOrderInput } from "./model";
import { buildStockOnOrderXlsxBuffer } from "./xlsx";

const input: StockOnOrderInput = {
  order: { number: "SO-14", poNumber: "BH-2026-118", orderDate: "2026-10-04", expectedDate: "2026-10-19", customerName: "Bhavesh Traders", status: "confirmed" },
  companyName: "Fourcubes Extrusions",
  lines: [
    {
      lineNo: 1, sectionCode: "12170", series: "Domal", sectionName: "Domal", cutLengthMm: 3658, orderedG: 1_200_000, orderedPcs: 100, pcs: 20, weightG: 240_000,
      bundles: [
        { serial: "26J12", partyNo: "26J12", status: "available", pcs: 10, weightG: 120_000, lengthMm: 3658, copyCode: "12170-1", yard: "Yard 1", packedAt: Date.UTC(2026, 9, 10, 8, 0) },
        { serial: "26J13", partyNo: "BT/9", status: "reserved", pcs: 10, weightG: 120_000, lengthMm: 3658, copyCode: null, yard: null, packedAt: Date.UTC(2026, 9, 10, 21, 0) },
      ],
    },
    { lineNo: 2, sectionCode: "13090", series: "Tee", sectionName: null, cutLengthMm: 5486, orderedG: 600_000, orderedPcs: null, pcs: 0, weightG: 0, bundles: [] },
  ],
  total: { bundles: 2, pcs: 20, weightG: 240_000 },
  strip: { orderedG: 1_800_000, dispatchedG: 120_000, bakiG: 1_680_000, inStockG: 240_000 },
  truncated: false,
};

describe("stock held on an order (FP-OP-19)", () => {
  test("the model groups by line, skips lines with no stock, and keeps the total the server gave", () => {
    const m = stockOnOrderModel(input);
    expect(m.groups.map((g) => [g.title, g.bundles, g.pcs, g.weightKg])).toEqual([["Line 1 · 12170 Domal · 12 ft", 2, 20, 240]]);
    expect(m.groups[0]!.rows[0]).toMatchObject({ bundleNo: "26J12", die: "12170 Domal", copy: "12170-1", cutLengthFt: 12, pcs: 10, weightKg: 120, yard: "Yard 1", packedOn: "2026-10-10", onDispatch: false });
    // The party number shows beside the serial when it differs; a bundle on a draft dispatch is marked.
    expect(m.groups[0]!.rows[1]).toMatchObject({ bundleNo: "26J13 (BT/9)", onDispatch: true, copy: "", yard: "" });
    // 21:00 UTC is already the next day in India.
    expect(m.groups[0]!.rows[1]!.packedOn).toBe("2026-10-11");
    expect(m.totals).toEqual({ bundles: 2, pcs: 20, weightKg: 240 });
    expect(m.strip).toEqual({ orderedKg: 1800, dispatchedKg: 120, inStockKg: 240, bakiKg: 1680 });
  });

  test("the print and the Excel sheet carry the same rows, the total and the baki strip, and no rate", () => {
    const m = stockOnOrderModel(input);
    const html = buildStockOnOrderHtml(m);
    for (const s of ["SO-14", "Bhavesh Traders", "BH-2026-118", "26J12", "12170-1", "240.000 kg", "Baki", "1,680.000 kg", "* on a dispatch"]) expect(html).toContain(s);
    expect(html.toLowerCase()).not.toContain("rate");
    const wb = XLSX.read(buildStockOnOrderXlsxBuffer(m), { type: "array" });
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, raw: true });
    const flat = grid.flat().map(String);
    for (const s of ["SO-14", "26J12", "Total 2 bundles", "Baki kg", "1680"]) expect(flat).toContain(s);
    expect(grid.find((r) => r[0] === "26J12")!.slice(0, 9)).toEqual(["26J12", "12170 Domal", "12170-1", 12, 144, 10, 120, "Yard 1", "2026-10-10"]);
    expect(flat.join(" ").toLowerCase()).not.toContain("rate");
  });

  test("an order with nothing in the yard says so, and a cut list says it was cut", () => {
    const m = stockOnOrderModel({ ...input, lines: input.lines.map((l) => ({ ...l, bundles: [], pcs: 0, weightG: 0 })), total: { bundles: 0, pcs: 0, weightG: 0 }, truncated: true });
    const html = buildStockOnOrderHtml(m);
    expect(html).toContain("No stock is held on this order.");
    expect(html).toContain("The list was cut");
    expect(m.groups).toEqual([]);
  });

  test("file names are safe", () => {
    expect(stockOnOrderFileName("SO-14")).toBe("stock-on-SO-14");
    expect(stockOnOrderFileName("SO/14 b")).toBe("stock-on-SO-14-b");
  });
});
