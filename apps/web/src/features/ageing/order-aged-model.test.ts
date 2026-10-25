import { describe, expect, test } from "bun:test";

import { agedBreakdown } from "./order-aged-model";

const none = { loadedPcs: 0, inOvenPcs: 0, outUntestedPcs: 0, heldPcs: 0, releasedPcs: 0, packedPcs: 0 };

describe("order line ageing breakdown (FP-AG-15)", () => {
  test("a line that never went to a trolley shows nothing", () => {
    expect(agedBreakdown(none)).toEqual([]);
  });
  test("loaded first, then only the stages that hold pieces, then packed", () => {
    const parts = agedBreakdown({ loadedPcs: 80, inOvenPcs: 30, outUntestedPcs: 0, heldPcs: 10, releasedPcs: 25, packedPcs: 15 });
    expect(parts.map((p) => [p.key, p.pcs])).toEqual([
      ["loaded", 80],
      ["inOven", 30],
      ["held", 10],
      ["released", 25],
      ["packed", 15],
    ]);
  });
  test("a fully packed line still says what was loaded and packed", () => {
    expect(agedBreakdown({ ...none, loadedPcs: 40, packedPcs: 40 }).map((p) => p.key)).toEqual(["loaded", "packed"]);
  });
});
