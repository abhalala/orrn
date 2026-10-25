import { describe, expect, test } from "bun:test";

import { copyText, orderBookRowOf, orderSheetInputOf, planSheetInputOf, type BookItem, type OrderGet, type PlanGet } from "./print-model";

const balance = {
  lineId: "L1",
  lineNo: 1,
  sectionCode: "12170",
  series: "Domal",
  sectionName: "Domal",
  cutLengthMm: 3658,
  finish: null,
  note: "Pack in 10s",
  orderedG: 1_200_000,
  orderedPcs: 100,
  dispatchedG: 200_000,
  bakiG: 1_000_000,
};

function getOf(details: Record<string, unknown>[]): OrderGet {
  return {
    order: { number: "SO-14", poNumber: "BH-118", orderDate: "2026-10-04", expectedDate: null, customerName: "Bhavesh", customerGstin: null, status: "confirmed", note: null },
    lines: [balance, { ...balance, lineId: "L2", lineNo: 2 }],
    lineDetails: details,
  } as unknown as OrderGet;
}

describe("FP-OP-19 print inputs", () => {
  test("copy or tier text", () => {
    expect(copyText({ dieInstanceId: "c", copyCode: "12170-2", tierRank: null })).toBe("12170-2");
    expect(copyText({ dieInstanceId: null, tierRank: 1 })).toBe("Tier 1 or better");
    expect(copyText({ dieInstanceId: null, tierRank: null })).toBe("");
    expect(copyText(undefined)).toBe("");
  });

  test("order sheet: no ratePaise key when the server sent none", () => {
    const input = orderSheetInputOf(
      getOf([
        { lineId: "L1", dieInstanceId: "c", copyCode: "12170-2", tierRank: null, alloy: "6063", temper: "T5" },
        { lineId: "L2", dieInstanceId: null, tierRank: 2, alloy: null, temper: null },
      ]),
      "Fourcubes",
    );
    expect(input.lines.map((l) => [l.lineNo, l.copy, l.alloy])).toEqual([
      [1, "12170-2", "6063"],
      [2, "Tier 2 or better", null],
    ]);
    expect(input.lines.every((l) => !("ratePaise" in l))).toBe(true);
    expect(input.lines[0]!.note).toBe("Pack in 10s");
  });

  test("order sheet: rates pass through when sent (null stays null)", () => {
    const input = orderSheetInputOf(
      getOf([
        { lineId: "L1", dieInstanceId: null, tierRank: 1, alloy: null, temper: null, ratePaise: 42_500 },
        { lineId: "L2", dieInstanceId: null, tierRank: 1, alloy: null, temper: null, ratePaise: null },
      ]),
      null,
    );
    expect(input.lines.map((l) => l.ratePaise)).toEqual([42_500, null]);
  });

  test("plan sheet: lines grouped under their die", () => {
    const data = {
      plan: { number: "PP-7", status: "released", purpose: "production", windowStart: "2026-10-25T02:30:00.000Z", windowEnd: "2026-10-26T02:30:00.000Z", note: null },
      dies: [
        { id: "D1", sectionCode: "12170", sectionName: "Domal", urgent: false },
        { id: "D2", sectionCode: "13090", sectionName: null, urgent: true },
      ],
      lines: [
        { pressPlanDieId: "D2", customerName: "KD", orderNumber: "SO-15", poNumber: null, lineNo: 1, cutLengthMm: 4877, pcs: null, kgG: 250_000 },
        { pressPlanDieId: "D1", customerName: "Bhavesh", orderNumber: "SO-14", poNumber: "BH", lineNo: 2, cutLengthMm: 3658, pcs: 50, kgG: 500_000 },
      ],
    } as unknown as PlanGet;
    const input = planSheetInputOf(data, "Fourcubes", "P1 Press 1");
    expect(input.plan).toMatchObject({ number: "PP-7", pressLine: "P1 Press 1", windowStart: Date.UTC(2026, 9, 25, 2, 30) });
    expect(input.dies.map((d) => [d.sectionCode, d.urgent, d.lines.map((l) => l.orderNumber)])).toEqual([
      ["12170", false, ["SO-14"]],
      ["13090", true, ["SO-15"]],
    ]);
  });

  test("order book row takes in-stock kg from the bar", () => {
    const item = { number: "SO-1", customerName: "A", city: null, poNumber: null, orderDate: "2026-10-01", expectedDate: null, status: "confirmed", lines: 1, orderedG: 10, dispatchedG: 2, bakiG: 8, lateDays: null, bar: { inStockG: 3 } } as unknown as BookItem;
    expect(orderBookRowOf(item)).toMatchObject({ number: "SO-1", inStockG: 3, bakiG: 8, lateDays: null });
  });
});
