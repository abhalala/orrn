import { describe, expect, test } from "bun:test";

import { ageBars, topSectionRows, type StockAgeingData } from "./charts-data";

const t = (key: string, vars?: Record<string, string | number>) => `${key}${vars ? JSON.stringify(vars) : ""}`;

const DATA: StockAgeingData = {
  asOf: "2026-10-03T06:00:00.000Z",
  totals: { bundles: 120, kgG: 5_870_400 },
  buckets: [
    { key: "0-15", minDays: 0, maxDays: 15, bundles: 100, kgG: 4_900_000 },
    { key: "16-30", minDays: 16, maxDays: 30, bundles: 12, kgG: 600_250 },
    { key: "31-60", minDays: 31, maxDays: 60, bundles: 8, kgG: 370_150 },
    { key: "60+", minDays: 61, maxDays: null, bundles: 0, kgG: 0 },
  ],
  topSections: [
    { sectionId: "die-a", label: "Patti 1\"", kgG: 2_000_000, bundles: 40, sharePct: 34.1 },
    { sectionId: "die-b", label: "Angle 1\"", kgG: 1_500_000, bundles: 30, sharePct: 25.6 },
    { sectionId: null, label: "Other", kgG: 2_370_400, bundles: 50, sharePct: 40.3 },
  ],
};

describe("ageBars", () => {
  test("four ordered buckets in kg, labelled in days", () => {
    const bars = ageBars(DATA, t);
    expect(bars.map((b) => b.key)).toEqual(["0-15", "16-30", "31-60", "60+"]);
    expect(bars.map((b) => b.value)).toEqual([4_900, 600.25, 370.15, 0]);
    expect(bars[0]).toMatchObject({ short: "0-15", label: 'stock.charts.bucket{"range":"0-15"}' });
  });

  test("never partial: stock age is a snapshot, not an open period", () => {
    expect(ageBars(DATA, t).some((b) => b.partial)).toBe(false);
  });
});

describe("topSectionRows", () => {
  test("ranked rows in kg with share, the folded rest as other", () => {
    const { rows, other } = topSectionRows(DATA, () => undefined);
    expect(rows).toEqual([
      { key: "die-a", label: 'Patti 1"', value: 2_000, share: 34.1 },
      { key: "die-b", label: 'Angle 1"', value: 1_500, share: 25.6 },
    ]);
    expect(other).toBe(2_370.4);
  });

  test("uses the screen's own section label when it knows the die", () => {
    const { rows } = topSectionRows(DATA, (id) => (id === "die-a" ? "PATTI 14701" : undefined));
    expect(rows.map((r) => r.label)).toEqual(["PATTI 14701", 'Angle 1"']);
  });

  test("no Other row: other is 0", () => {
    const { other } = topSectionRows({ ...DATA, topSections: DATA.topSections.slice(0, 2) }, () => undefined);
    expect(other).toBe(0);
  });
});
