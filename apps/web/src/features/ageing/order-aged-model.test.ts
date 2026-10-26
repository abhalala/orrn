import { describe, expect, test } from "bun:test";

import { agedBreakdown } from "./order-aged-model";

const none = { loadedPcs: 0, inOvenPcs: 0, outUntestedPcs: 0, heldPcs: 0, releasedPcs: 0, packedPcs: 0, remainingPcs: 0 };

describe("order line ageing breakdown (FP-AG-15)", () => {
  test("a line that never went to a trolley shows nothing", () => {
    expect(agedBreakdown(none)).toEqual([]);
  });
  test("empty intermediate stages do not claim to hold pieces", () => {
    const parts = agedBreakdown({ ...none, loadedPcs: 40, packedPcs: 40 });
    expect(parts.some((p) => ["inOven", "outUntested", "held", "released"].includes(p.key))).toBe(false);
    expect(parts).toContainEqual({ key: "loaded", pcs: 40, tone: "neutral" });
    expect(parts).toContainEqual({ key: "packed", pcs: 40, tone: "green" });

  });
});
