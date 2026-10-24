import { describe, expect, test } from "bun:test";

import {
  ORDER_GRAMS_DIVISOR,
  bakiOf,
  bundleAllocation,
  confirmBlockers,
  inchExactMm,
  orderGrams,
  orderPieces,
  overDispatchBeyondTolerance,
  planableG,
  reallocationCheck,
} from "./orders";

describe("orderGrams / orderPieces (OP §3: divisor = 304.8 x 12 x 10 = 36576)", () => {
  test("the divisor", () => {
    expect(ORDER_GRAMS_DIVISOR).toBe(36_576);
  });

  test("spec cases at exact feet (inch companies snap to the quarter inch)", () => {
    // 30 pcs x 18 ft x 12.000 kg/12ft = 540.000 kg; at 12.300 = 553.500 kg.
    expect(orderGrams(30, 5_486, 12_000, "inch")).toBe(540_000);
    expect(orderGrams(30, 5_486, 12_300, "inch")).toBe(553_500);
    // 200 pcs x 12 ft at 1.650 = 330.000 kg; at 1.672 = 334.400 kg.
    expect(orderGrams(200, 3_658, 1_650, "inch")).toBe(330_000);
    expect(orderGrams(200, 3_658, 1_672, "inch")).toBe(334_400);
    // 8,000 kg at 12.000, 12 ft: 667 pcs (implied 8,004 kg).
    expect(orderPieces(8_000_000, 3_658, 12_000, "inch")).toBe(667);
    expect(orderGrams(667, 3_658, 12_000, "inch")).toBe(8_004_000);
    expect(orderGrams(666, 3_658, 12_000, "inch")).toBe(7_992_000);
  });

  test("mm companies use the whole mm as stored: 18 ft typed as 5486 mm is 539.961 kg", () => {
    expect(orderGrams(30, 5_486, 12_000)).toBe(539_961);
    expect(orderGrams(30, 5_486.4, 12_000)).toBe(540_000);
  });

  test("quarter-inch snap: 3658 mm is 144 in, 5486 mm is 216 in", () => {
    expect(inchExactMm(3_658)).toBeCloseTo(3_657.6, 9);
    expect(inchExactMm(5_486)).toBeCloseTo(5_486.4, 9);
  });

  test("zero or missing basis gives 0 pcs / 0 g, never NaN", () => {
    expect(orderPieces(1_000, 3_658, 0)).toBe(0);
    expect(orderGrams(0, 3_658, 12_000)).toBe(0);
  });
});

describe("baki and planable (C17, OP §6)", () => {
  test("baki = max(0, ordered - dispatched); over is the excess; pressed never moves it", () => {
    expect(bakiOf({ orderedG: 8_000_000, dispatchedG: 6_700_000, orderedPcs: 667, dispatchedPcs: 559 })).toEqual({
      bakiG: 1_300_000,
      bakiPcs: 108,
      overG: 0,
      overPcs: 0,
    });
    expect(bakiOf({ orderedG: 1_000, dispatchedG: 1_200, orderedPcs: 10, dispatchedPcs: 12 })).toEqual({
      bakiG: 0,
      bakiPcs: 0,
      overG: 200,
      overPcs: 2,
    });
  });

  test("planable = ordered - dispatched - packed - planned - pressed - aged, floored at 0", () => {
    expect(planableG({ orderedG: 8_000, dispatchedG: 3_000, packedG: 1_000, plannedG: 1_500, pressedG: 500, agedG: 0 })).toBe(2_000);
    expect(planableG({ orderedG: 1_000, dispatchedG: 900, packedG: 200, plannedG: 0, pressedG: 0, agedG: 0 })).toBe(0);
  });

  test("over-dispatch tolerance in bp of ordered kg (customer.kg_tolerance_bp, default 0)", () => {
    expect(overDispatchBeyondTolerance({ orderedG: 100_000, dispatchedAfterG: 100_000, toleranceBp: 0 })).toBe(false);
    expect(overDispatchBeyondTolerance({ orderedG: 100_000, dispatchedAfterG: 100_001, toleranceBp: 0 })).toBe(true);
    expect(overDispatchBeyondTolerance({ orderedG: 100_000, dispatchedAfterG: 100_500, toleranceBp: 50 })).toBe(false);
    expect(overDispatchBeyondTolerance({ orderedG: 100_000, dispatchedAfterG: 100_501, toleranceBp: 50 })).toBe(true);
  });
});

describe("confirm checks (OP §6)", () => {
  const line = { pcs: 10, kgG: 1_000, cutLengthMm: 3_658, alloy: "6063", temper: "T6", dieInstanceId: null, tierRank: 1 };
  test("a complete order confirms", () => {
    expect(confirmBlockers({ poNumber: "AN-1842", lines: [line], dieRequired: true })).toEqual([]);
  });
  test("missing PO, no lines, missing fields, die or tier when required", () => {
    expect(confirmBlockers({ poNumber: " ", lines: [], dieRequired: true })).toEqual(["po_number", "no_lines"]);
    expect(confirmBlockers({ poNumber: "X", lines: [{ ...line, alloy: "", tierRank: null }], dieRequired: true })).toEqual([
      "line_1_alloy",
      "line_1_die_or_tier",
    ]);
    expect(confirmBlockers({ poNumber: "X", lines: [{ ...line, tierRank: null }], dieRequired: false })).toEqual([]);
  });
});

describe("plant stock vs unassigned (C8)", () => {
  test("a line wins; a transfer to null is plant stock; legacy null with no transfer is unassigned", () => {
    expect(bundleAllocation({ salesOrderLineId: "l1", latestTransfer: null })).toBe("assigned");
    expect(bundleAllocation({ salesOrderLineId: null, latestTransfer: { toSalesOrderLineId: null } })).toBe("plant");
    expect(bundleAllocation({ salesOrderLineId: null, latestTransfer: null })).toBe("unassigned");
  });
});

describe("reallocation guard (D6: same die required; length mismatch warns and needs a reason code)", () => {
  const bundle = { status: "available" as const, dieId: "d1", lengthMm: 3_658, heldOnDispatchCode: null, customerId: "anshu" };

  test("same customer, same die and length: applies with no approval", () => {
    expect(reallocationCheck({ bundle, target: { dieId: "d1", cutLengthMm: 3_658, customerId: "anshu" } })).toEqual({
      ok: true,
      needsApproval: false,
      warnings: [],
      reasonCodeKind: null,
    });
  });

  test("to plant stock never needs an approval", () => {
    expect(reallocationCheck({ bundle, target: null })).toEqual({ ok: true, needsApproval: false, warnings: [], reasonCodeKind: null });
  });

  test("other customer needs order_reallocate; length mismatch warns and asks a reason code", () => {
    expect(reallocationCheck({ bundle, target: { dieId: "d1", cutLengthMm: 4_267, customerId: "bhavesh" } })).toEqual({
      ok: true,
      needsApproval: true,
      warnings: ["length_mismatch"],
      reasonCodeKind: "reallocate",
    });
  });

  test("refusals: dispatched, void, reserved/held (names the dispatch), die mismatch", () => {
    expect(reallocationCheck({ bundle: { ...bundle, status: "dispatched" }, target: null })).toEqual({ ok: false, refusal: "dispatched" });
    expect(reallocationCheck({ bundle: { ...bundle, status: "void" }, target: null })).toEqual({ ok: false, refusal: "void" });
    expect(reallocationCheck({ bundle: { ...bundle, status: "reserved", heldOnDispatchCode: "DN-14" }, target: null })).toEqual({
      ok: false,
      refusal: "held",
      dispatchCode: "DN-14",
    });
    expect(reallocationCheck({ bundle, target: { dieId: "d2", cutLengthMm: 3_658, customerId: "anshu" } })).toEqual({
      ok: false,
      refusal: "die_mismatch",
    });
  });

  test("an unassigned or plant-stock bundle (no customer) going to a line is a same-plant move: no approval", () => {
    expect(reallocationCheck({ bundle: { ...bundle, customerId: null }, target: { dieId: "d1", cutLengthMm: 3_658, customerId: "bhavesh" } }).ok).toBe(true);
    const r = reallocationCheck({ bundle: { ...bundle, customerId: null }, target: { dieId: "d1", cutLengthMm: 3_658, customerId: "bhavesh" } });
    expect(r.ok && r.needsApproval).toBe(false);
  });
});
