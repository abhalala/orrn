import { describe, expect, test } from "bun:test";
import * as XLSX from "xlsx";

import { buildOrderSheetHtml, buildPlanSheetHtml } from "./html";
import { orderBookCells, orderSheetColumns, orderSheetFileName, orderSheetModel, planSheetFileName, planSheetModel, type OrderSheetInput, type PlanSheetInput } from "./model";
import { buildOrderBookXlsxBuffer, buildOrderSheetXlsxBuffer, buildPlanSheetXlsxBuffer } from "./xlsx";

const line = (over: Partial<OrderSheetInput["lines"][number]> = {}): OrderSheetInput["lines"][number] => ({
  lineNo: 1,
  sectionCode: "12170",
  series: "Domal",
  sectionName: "Domal",
  cutLengthMm: 3658,
  copy: "12170-2",
  alloy: "6063",
  temper: "T5",
  finish: null,
  orderedPcs: 100,
  orderedG: 1_200_000,
  dispatchedG: 200_000,
  bakiG: 1_000_000,
  note: null,
  ...over,
});

const order: OrderSheetInput["order"] = {
  number: "SO-14",
  poNumber: "BH-118",
  orderDate: "2026-10-04",
  expectedDate: null,
  customerName: "Bhavesh <Traders>",
  customerGstin: "24ABCDE1234F1Z9",
  status: "confirmed",
  note: null,
};

describe("order sheet (FP-OP-19)", () => {
  test("no rate column unless the server sent rates; lines in order; totals", () => {
    const m = orderSheetModel({ companyName: "Fourcubes", order, lines: [line({ lineNo: 2, cutLengthMm: 5486, orderedPcs: null, alloy: null }), line()] });
    expect(m.showRate).toBe(false);
    expect(orderSheetColumns(m)).not.toContain("Rate Rs/kg");
    expect(m.rows.map((r) => [r.lineNo, r.die, r.cutLengthFt, r.alloyTemper])).toEqual([
      [1, "12170 Domal", 12, "6063 T5"],
      [2, "12170 Domal", 18, "T5"],
    ]);
    expect(m.totals).toEqual({ pcs: 100, orderedKg: 2400, dispatchedKg: 400, bakiKg: 2000 });
    const html = buildOrderSheetHtml(m);
    expect(html).toContain("SO-14");
    expect(html).toContain("Bhavesh &lt;Traders&gt;");
    expect(html).not.toContain("Rate");
    expect(html).not.toContain("not a tax invoice");
  });

  test("with rates: a rate column (Rs/kg), a missing rate is blank, and the not-an-invoice note", () => {
    const m = orderSheetModel({ companyName: null, order, lines: [line({ ratePaise: 42_500 }), line({ lineNo: 2, ratePaise: null })] });
    expect(m.showRate).toBe(true);
    expect(m.rows.map((r) => r.rateRupees)).toEqual([425, null]);
    const html = buildOrderSheetHtml(m);
    expect(html).toContain("Rate Rs/kg");
    expect(html).toContain("425.00");
    expect(html).toContain("not a tax invoice");
  });

  test("xlsx: header block, a row per line, the total row", () => {
    const m = orderSheetModel({ companyName: "Fourcubes", order, lines: [line()] });
    const wb = XLSX.read(buildOrderSheetXlsxBuffer(m), { type: "array" });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Order"]!, { header: 1 });
    expect(rows[1]).toEqual(["Order", "SO-14"]);
    expect(rows[8]).toEqual(orderSheetColumns(m));
    expect(rows[9]).toEqual([1, "12170 Domal", "12170-2", 12, 144, "6063 T5", "", 100, 1200, 200, 1000]);
    expect(rows[10]?.[0]).toBe("Total");
    expect(orderSheetFileName("SO-14/26")).toBe("order-SO-14-26");
  });
});

const plan: PlanSheetInput = {
  companyName: "Fourcubes",
  plan: { number: "PP-7", status: "released", purpose: "production", pressLine: "P1", windowStart: Date.UTC(2026, 9, 25, 2, 30), windowEnd: Date.UTC(2026, 9, 26, 2, 30), note: null },
  dies: [
    {
      sectionCode: "12170",
      sectionName: "Domal",
      urgent: true,
      lines: [
        { customerName: "Bhavesh", orderNumber: "SO-14", poNumber: "BH-118", lineNo: 1, cutLengthMm: 3658, pcs: 100, kgG: 500_000 },
        { customerName: "KD", orderNumber: "SO-15", poNumber: null, lineNo: 2, cutLengthMm: 4877, pcs: null, kgG: 250_500 },
      ],
    },
  ],
};

describe("shift die list (FP-OP-19 plan print)", () => {
  test("per die blocks with totals and the window in plant time; no rate anywhere", () => {
    const m = planSheetModel(plan);
    expect(m.header.window).toBe("25 Oct, 08:00 to 26 Oct, 08:00");
    expect(m.dies[0]).toMatchObject({ title: "12170 Domal", urgent: true, pcs: 100, kg: 750.5 });
    expect(m.dies[0]!.rows[1]).toMatchObject({ order: "SO-15 / 2", po: "", cutLengthFt: 16, pcs: null });
    expect(m.totals).toEqual({ dies: 1, pcs: 100, kg: 750.5 });
    const html = buildPlanSheetHtml(m);
    expect(html).toContain("Shift die list");
    expect(html).toContain("URGENT");
    expect(html).not.toMatch(/Rate|Rs\/kg|₹/);
    const wb = XLSX.read(buildPlanSheetXlsxBuffer(m), { type: "array" });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Plan"]!, { header: 1 });
    expect(rows[5]).toEqual(["12170 Domal (urgent)"]);
    expect(rows[7]).toEqual(["Bhavesh", "SO-14 / 1", "BH-118", 12, 144, 100, 500]);
    expect(planSheetFileName("PP-7")).toBe("plan-PP-7");
  });
});

describe("order book export", () => {
  test("one row per order, kg, no rate", () => {
    const row = { number: "SO-14", customerName: "Bhavesh", city: "Surat", poNumber: null, orderDate: "2026-10-04", expectedDate: null, status: "confirmed", lines: 2, orderedG: 1_800_000, dispatchedG: 120_000, bakiG: 1_680_000, inStockG: 240_000, lateDays: 6 };
    expect(orderBookCells(row)).toEqual(["SO-14", "Bhavesh", "Surat", "", "2026-10-04", "", "confirmed", 2, 1800, 120, 240, 1680, 6]);
    const wb = XLSX.read(buildOrderBookXlsxBuffer([row]), { type: "array" });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Order book"]!, { header: 1 });
    expect(rows).toHaveLength(2);
    expect(rows[0]).not.toContain("Rate Rs/kg");
  });
});
