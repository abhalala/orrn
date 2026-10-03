import { describe, expect, test } from "bun:test";

import { filterSections, mergeSections, sectionTotals, sortSections, type SummaryRow } from "./sections";

const row = (over: Partial<SummaryRow> & { dieId: string }): SummaryRow => ({
  dieSeries: "PATTI",
  dieSectionCode: "14701",
  dieName: null,
  dieWeightMinG: 2_400,
  dieWeightMaxG: 2_600,
  bundleCount: 1,
  totalQuantity: 20,
  totalWeightG: 50_000,
  totalLengthMm: 3_658,
  ...over,
});

describe("mergeSections", () => {
  test("joins available and held stock per die", () => {
    const merged = mergeSections(
      [row({ dieId: "a", bundleCount: 12, totalWeightG: 600_250 }), row({ dieId: "b", dieSectionCode: "11250" })],
      [row({ dieId: "a", bundleCount: 3, totalWeightG: 150_000 })],
    );
    expect(merged).toHaveLength(2);
    const a = merged.find((s) => s.dieId === "a")!;
    expect(a.available).toEqual({ bundles: 12, weightG: 600_250 });
    expect(a.held).toEqual({ bundles: 3, weightG: 150_000 });
    const b = merged.find((s) => s.dieId === "b")!;
    expect(b.held).toEqual({ bundles: 0, weightG: 0 });
  });

  test("keeps a section whose whole stock is held", () => {
    const merged = mergeSections([], [row({ dieId: "c", bundleCount: 4, totalWeightG: 200_000 })]);
    expect(merged).toEqual([
      expect.objectContaining({ dieId: "c", available: { bundles: 0, weightG: 0 }, held: { bundles: 4, weightG: 200_000 } }),
    ]);
  });

  test("D1 returns aggregates as numbers or strings; both become numbers", () => {
    const merged = mergeSections(
      [row({ dieId: "a", bundleCount: "7" as unknown as number, totalWeightG: "350000" as unknown as number })],
      [],
    );
    expect(merged[0]!.available).toEqual({ bundles: 7, weightG: 350_000 });
  });

  test("carries the die band and label", () => {
    const [s] = mergeSections([row({ dieId: "a", dieName: `Patti 1" x 1/8"` })], []);
    expect(s).toMatchObject({ series: "PATTI", sectionCode: "14701", name: `Patti 1" x 1/8"`, weightMinG: 2_400, weightMaxG: 2_600 });
  });
});

describe("sortSections", () => {
  const rows = mergeSections(
    [
      row({ dieId: "small", dieSeries: "TEE", dieSectionCode: "13090", totalWeightG: 100_000 }),
      row({ dieId: "big", dieSeries: "ANGLE", dieSectionCode: "11250", totalWeightG: 900_000 }),
      row({ dieId: "mid", dieSeries: "ANGLE", dieSectionCode: "11262", totalWeightG: 400_000 }),
      row({ dieId: "ten", dieSeries: "ANGLE", dieSectionCode: "9", totalWeightG: 400_000 }),
    ],
    [row({ dieId: "held", dieSeries: "CHANNEL", dieSectionCode: "12212", totalWeightG: 950_000 })],
  );

  test("most kg: by kg in stock (available), held-only sections last, ties A to Z", () => {
    expect(sortSections(rows, "kg").map((s) => s.dieId)).toEqual(["big", "ten", "mid", "small", "held"]);
  });

  test("A to Z: by series then section code, numbers in number order", () => {
    expect(sortSections(rows, "az").map((s) => s.dieId)).toEqual(["ten", "big", "mid", "held", "small"]);
  });

  test("does not reorder the input array", () => {
    const before = rows.map((s) => s.dieId);
    sortSections(rows, "az");
    expect(rows.map((s) => s.dieId)).toEqual(before);
  });
});

describe("filterSections", () => {
  const rows = mergeSections(
    [
      row({ dieId: "p", dieSeries: "PATTI", dieSectionCode: "14701", dieName: `Patti 1" x 1/8"` }),
      row({ dieId: "a", dieSeries: "ANGLE", dieSectionCode: "11250", dieName: `Angle 1" x 1"` }),
    ],
    [],
  );

  test("matches series, section code or die name, any case", () => {
    expect(filterSections(rows, "angle").map((s) => s.dieId)).toEqual(["a"]);
    expect(filterSections(rows, "147").map((s) => s.dieId)).toEqual(["p"]);
    expect(filterSections(rows, "PATTI 1\"").map((s) => s.dieId)).toEqual(["p"]);
  });

  test("matches the label as printed, series and code together", () => {
    expect(filterSections(rows, "patti 14701").map((s) => s.dieId)).toEqual(["p"]);
  });

  test("blank query keeps everything; extra spaces are ignored", () => {
    expect(filterSections(rows, "   ")).toHaveLength(2);
    expect(filterSections(rows, "  angle   11250 ").map((s) => s.dieId)).toEqual(["a"]);
  });
});

describe("sectionTotals", () => {
  test("adds available and held separately", () => {
    const rows = mergeSections(
      [row({ dieId: "a", bundleCount: 2, totalWeightG: 100_000 }), row({ dieId: "b", bundleCount: 5, totalWeightG: 250_500 })],
      [row({ dieId: "a", bundleCount: 1, totalWeightG: 50_000 })],
    );
    expect(sectionTotals(rows)).toEqual({
      available: { bundles: 7, weightG: 350_500 },
      held: { bundles: 1, weightG: 50_000 },
      sections: 2,
    });
  });
});
