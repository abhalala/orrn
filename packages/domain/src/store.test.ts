import { describe, expect, test } from "bun:test";

import {
  averageRatePaise,
  belowMinimum,
  DEFAULT_PO_OVER_RECEIPT_BP,
  grnValuePaise,
  heldValueShown,
  issueValuePaise,
  lineValuePaise,
  maxReceivableMilli,
  monthValuation,
  nextIndentStatus,
  poCancellable,
  poClosableByHand,
  poEditable,
  poLineMoney,
  poStatusFromReceipts,
  poTotals,
  rateFitsQty,
  readPoOverReceiptBp,
  reorderQtyMilli,
  STORE_MAX_QTY_MILLI,
  STORE_MAX_RATE_PAISE,
  type ValuationEntry,
} from "./store";

const U = 1000;

describe("store valuation (row 73)", () => {
  test("a GRN is worth quantity x rate; no rate is worth 0", () => {
    // 12.5 kg of flux at ₹84.40 per kg = ₹1,055.00
    expect(grnValuePaise(12_500, 8_440)).toBe(105_500);
    expect(grnValuePaise(12_500, null)).toBe(0);
    // 0.333 kg at ₹1.00 = 33.3 paise → 33
    expect(lineValuePaise(333, 100)).toBe(33);
    expect(lineValuePaise(335, 100)).toBe(34);
  });

  test("worked example: two GRNs at different rates, then issues at the weighted average", () => {
    // GRN 10 kg @ ₹100 = ₹1,000; GRN 10 kg @ ₹200 = ₹2,000 → 20 kg worth ₹3,000, average ₹150/kg.
    let held = 20 * U;
    let value = grnValuePaise(10 * U, 10_000) + grnValuePaise(10 * U, 20_000);
    expect(value).toBe(300_000);
    expect(averageRatePaise(held, value)).toBe(15_000);
    // Issue 5 kg → ₹750.
    const out1 = issueValuePaise(held, value, 5 * U);
    expect(out1).toBe(75_000);
    held -= 5 * U;
    value -= out1;
    // Issue 3.333 kg of the remaining 15 kg worth ₹2,250 → 2250 × 3.333 / 15 = ₹499.95
    const out2 = issueValuePaise(held, value, 3_333);
    expect(out2).toBe(49_995);
    held -= 3_333;
    value -= out2;
    // The last issue takes everything left, so nothing is held at a value.
    const out3 = issueValuePaise(held, value, held);
    expect(out3).toBe(value);
    expect(heldValueShown(0, value - out3)).toBe(0);
  });

  test("an issue never goes negative and an empty or unvalued holding issues at 0", () => {
    expect(issueValuePaise(0, 0, 1000)).toBe(0);
    expect(issueValuePaise(10 * U, -500, 1000)).toBe(0);
    expect(issueValuePaise(10 * U, 0, 1000)).toBe(0);
    // Over-issue cannot happen (the store refuses it) but the formula still takes at most what is held.
    expect(issueValuePaise(1000, 777, 5000)).toBe(777);
  });

  test("averages and shown values clamp at 0", () => {
    expect(averageRatePaise(0, 100)).toBeNull();
    expect(averageRatePaise(2 * U, -100)).toBe(0);
    expect(heldValueShown(5 * U, -1)).toBe(0);
    expect(heldValueShown(5 * U, 123)).toBe(123);
  });

  test("the largest quantity at the largest rate stays an exact integer", () => {
    expect(rateFitsQty(STORE_MAX_QTY_MILLI, 90_000_000)).toBe(true);
    expect(rateFitsQty(STORE_MAX_QTY_MILLI, STORE_MAX_RATE_PAISE)).toBe(false);
    expect(rateFitsQty(1_000_000, STORE_MAX_RATE_PAISE)).toBe(true);
  });
});

describe("month report", () => {
  const day = (d: number) => Date.UTC(2026, 9, d);
  const from = day(1);
  const to = Date.UTC(2026, 10, 1);
  test("opening, in, out, closing with cancels in and before the month", () => {
    const entries: ValuationEntry[] = [
      { kind: "grn", qtyMilli: 10 * U, valuePaise: 100_000, createdAt: from - 1000, cancelledAt: null }, // before
      { kind: "grn", qtyMilli: 5 * U, valuePaise: 75_000, createdAt: day(3), cancelledAt: null }, // in
      { kind: "mrs", qtyMilli: 4 * U, valuePaise: 46_667, createdAt: day(5), cancelledAt: null }, // out
      { kind: "mrs", qtyMilli: 1 * U, valuePaise: 11_667, createdAt: day(6), cancelledAt: day(7) }, // out and back
      { kind: "grn", qtyMilli: 2 * U, valuePaise: 20_000, createdAt: from - 500, cancelledAt: day(9) }, // before, cancelled now
      { kind: "grn", qtyMilli: 3 * U, valuePaise: 30_000, createdAt: to + 10, cancelledAt: null }, // after
    ];
    const r = monthValuation(entries, from, to);
    expect(r).toEqual({
      openingMilli: 12 * U,
      openingPaise: 120_000,
      inMilli: 5 * U - 2 * U,
      inPaise: 75_000 - 20_000,
      outMilli: 4 * U,
      outPaise: 46_667,
      closingMilli: 11 * U,
      closingPaise: 120_000 + 55_000 - 46_667,
    });
  });
});

describe("purchase orders (rows 70, 71)", () => {
  test("line money: amount, GST per line, total", () => {
    // 25 L of LDO at ₹92.35 = ₹2,308.75; 18 % GST = ₹415.575 → ₹415.58
    expect(poLineMoney({ qtyMilli: 25 * U, ratePaise: 9_235, gstBp: 1_800 })).toEqual({
      amountPaise: 230_875,
      gstPaise: 41_558,
      totalPaise: 272_433,
    });
    expect(
      poTotals([
        { qtyMilli: 25 * U, ratePaise: 9_235, gstBp: 1_800 },
        { qtyMilli: 2 * U, ratePaise: 150_000, gstBp: 1_200 },
      ]),
    ).toEqual({ amountPaise: 530_875, gstPaise: 77_558, totalPaise: 608_433 });
  });

  test("over-receipt tolerance", () => {
    expect(maxReceivableMilli(100 * U, 500)).toBe(105 * U);
    expect(maxReceivableMilli(100 * U, 0)).toBe(100 * U);
    // floor: 3 pieces at 5 % allows 3.15 → stays 3150 milli (the count rule is the item's, not this one's)
    expect(maxReceivableMilli(3 * U, 500)).toBe(3_150);
    expect(readPoOverReceiptBp(undefined)).toBe(DEFAULT_PO_OVER_RECEIPT_BP);
    expect(readPoOverReceiptBp(0)).toBe(0);
    expect(readPoOverReceiptBp(250)).toBe(250);
    expect(readPoOverReceiptBp(99_999)).toBe(DEFAULT_PO_OVER_RECEIPT_BP);
    expect(readPoOverReceiptBp("5")).toBe(DEFAULT_PO_OVER_RECEIPT_BP);
  });

  test("status from receipts", () => {
    expect(poStatusFromReceipts([{ orderedMilli: 10, receivedMilli: 0 }])).toBe("issued");
    expect(poStatusFromReceipts([{ orderedMilli: 10, receivedMilli: 4 }])).toBe("part_received");
    expect(
      poStatusFromReceipts([
        { orderedMilli: 10, receivedMilli: 10 },
        { orderedMilli: 5, receivedMilli: 0 },
      ]),
    ).toBe("part_received");
    expect(
      poStatusFromReceipts([
        { orderedMilli: 10, receivedMilli: 11 },
        { orderedMilli: 5, receivedMilli: 5 },
      ]),
    ).toBe("closed");
  });

  test("what each status allows", () => {
    expect(poEditable("draft")).toBe(true);
    expect(poEditable("issued")).toBe(false);
    expect(poCancellable("draft", false)).toBe(true);
    expect(poCancellable("issued", false)).toBe(true);
    expect(poCancellable("issued", true)).toBe(false);
    expect(poCancellable("part_received", true)).toBe(false);
    expect(poClosableByHand("part_received")).toBe(true);
    expect(poClosableByHand("issued")).toBe(false);
    expect(poClosableByHand("closed")).toBe(false);
  });
});

describe("indents and reorder (rows 69, 72)", () => {
  test("status flow", () => {
    expect(nextIndentStatus("open", "approve")).toBe("approved");
    expect(nextIndentStatus("open", "reject")).toBe("rejected");
    expect(nextIndentStatus("open", "order")).toBeNull();
    expect(nextIndentStatus("approved", "order")).toBe("ordered");
    expect(nextIndentStatus("approved", "approve")).toBeNull();
    expect(nextIndentStatus("approved", "cancel")).toBe("cancelled");
    expect(nextIndentStatus("ordered", "cancel")).toBeNull();
    expect(nextIndentStatus("rejected", "approve")).toBeNull();
  });

  test("below minimum and the reorder quantity", () => {
    expect(belowMinimum(4 * U, 5 * U)).toBe(true);
    expect(belowMinimum(5 * U, 5 * U)).toBe(false);
    expect(belowMinimum(0, null)).toBe(false);
    expect(belowMinimum(0, 0)).toBe(false);
    expect(reorderQtyMilli({ balanceMilli: 4 * U, minMilli: 5 * U, reorderMilli: 20 * U, countable: false })).toBe(20 * U);
    // No reorder quantity: top up to the minimum.
    expect(reorderQtyMilli({ balanceMilli: 1_500, minMilli: 5 * U, reorderMilli: null, countable: false })).toBe(3_500);
    // Countable units round up to whole pieces.
    expect(reorderQtyMilli({ balanceMilli: 1_500, minMilli: 5 * U, reorderMilli: null, countable: true })).toBe(4 * U);
    expect(reorderQtyMilli({ balanceMilli: -2 * U, minMilli: 1 * U, reorderMilli: null, countable: false })).toBe(1 * U);
  });
});
