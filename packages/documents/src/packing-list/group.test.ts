import { describe, expect, test } from "bun:test";
import { formatWeightRange12ft } from "@orrn/server/lib/weight-range";

import fixtureJson from "./fixtures/ambica-38.json";
import { groupPlItems } from "./group";
import type { PLSnapshot } from "./snapshot";

const fixture = fixtureJson as PLSnapshot;

describe("groupPlItems", () => {
  test("groups the 38-lot AMBICA truck in first-seen order", () => {
    const grouped = groupPlItems(fixture.items);
    expect(grouped.groups.map((group) => group.label)).toEqual([
      "8061 25X45 CLIP", "8045 29mm Track Rail", "8013 25mm Folding Profile", "8014 25mm Folding Clip",
    ]);
    expect(grouped.groups.map((group) => [group.lotFrom, group.lotTo])).toEqual([[1, 12], [13, 22], [23, 28], [29, 38]]);
    expect(grouped.groups.map((group) => group.subtotal.bundles)).toEqual([12, 10, 6, 10]);
    expect(grouped.net.bundles).toBe(38);
    expect(grouped.net.weightKg).toBeCloseTo(1205.35, 2);
  });

  test("puts null labels in one UNGROUPED section", () => {
    const items = fixture.items.slice(0, 3).map((item) => ({ ...item, groupId: "", groupLabel: undefined }));
    expect(groupPlItems(items).groups.map((group) => group.label)).toEqual(["UNGROUPED"]);
  });

  test("prefers stored group order", () => {
    const groups = ["8014 25mm Folding Clip", "8061 25X45 CLIP"].map((label) => ({ label, firstSeenAt: "", bundleCount: 0, quantity: 0, weightKg: 0, lotFrom: 0, lotTo: 0 }));
    const grouped = groupPlItems([...fixture.items.slice(0, 1), ...fixture.items.slice(28, 29)], groups);
    expect(grouped.groups.map((group) => group.label)).toEqual(groups.map((group) => group.label));
  });
});

test("Excel ROUND slab", () => {
  expect(formatWeightRange12ft(0.44)).toBe("0.400");
  expect(formatWeightRange12ft(0.64)).toBe("0.600");
  expect(formatWeightRange12ft(0.84)).toBe("0.800");
});
