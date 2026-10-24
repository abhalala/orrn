import { describe, expect, test } from "bun:test";

import { dispatchTotals, groupItems, itemLabel, type DispatchItem } from "./group-items";

const RECEIPT = "3f2b9c1e-8a4d-4f6b-9c2e-7d1a5b8e0f42";

function item(serial: string, over: Partial<DispatchItem> = {}): DispatchItem {
  return {
    itemId: `i-${serial}`,
    bundleId: `b-${serial}`,
    serial,
    status: "available",
    quantity: 20,
    weightG: 50_000,
    lengthMm: 3658,
    groupId: RECEIPT,
    groupLabel: null,
    dieId: "die-patti",
    dieSeries: "PATTI",
    dieSectionCode: "14701",
    dieName: 'Patti 1" × 1/8"',
    ...over,
  };
}

const angle = { dieId: "die-angle", dieSeries: "ANGLE", dieSectionCode: "11250", dieName: 'Angle 1" × 1"' };

describe("itemLabel", () => {
  test("section code and name, else code and series", () => {
    expect(itemLabel(item("A"))).toBe('14701 Patti 1" × 1/8"');
    expect(itemLabel(item("A", { dieName: null }))).toBe("14701 PATTI");
  });
});

describe("groupItems", () => {
  test("groups by section when there are no packing group labels, never by the packing session", () => {
    const groups = groupItems([item("26I4087"), item("26I4101", angle), item("26I4086")]);
    expect(groups.map((g) => g.label)).toEqual(['11250 Angle 1" × 1"', '14701 Patti 1" × 1/8"']);
    for (const g of groups) expect(g.key).not.toContain(RECEIPT);
    // Within a group the server's order is kept (newest first while building).
    expect(groups[1]!.bundles.map((b) => b.serial)).toEqual(["26I4087", "26I4086"]);
  });

  test("a packing group label wins over the section, labelled groups first in label order", () => {
    const groups = groupItems([
      item("X1"),
      item("X2", { groupLabel: "B" }),
      item("X3", { ...angle, groupLabel: "A" }),
      item("X4", { groupLabel: "A" }),
    ]);
    expect(groups.map((g) => [g.label, g.labelled, g.bundles.length])).toEqual([
      ["A", true, 2],
      ["B", true, 1],
      ['14701 Patti 1" × 1/8"', false, 1],
    ]);
    expect(groups[0]!.dieLabel).toBe('11250 Angle 1" × 1", 14701 Patti 1" × 1/8"');
    expect(groups[1]!.dieLabel).toBe('14701 Patti 1" × 1/8"');
  });

  test("subtotals count grams and pieces", () => {
    const [g] = groupItems([item("A", { weightG: 50_455, quantity: 20 }), item("B", { weightG: 52_400, quantity: 21 })]);
    expect(g!.weightG).toBe(102_855);
    expect(g!.pieces).toBe(41);
  });

  test("blank labels are no label", () => {
    const groups = groupItems([item("A", { groupLabel: "  " })]);
    expect(groups[0]!.labelled).toBe(false);
  });
});

describe("dispatchTotals", () => {
  test("bundles and grams across all items", () => {
    expect(dispatchTotals([item("A", { weightG: 1_500 }), item("B", { weightG: 2_250 })])).toEqual({ bundles: 2, weightG: 3_750, pieces: 40 });
  });
});
