import { describe, expect, test } from "bun:test";

import { chartWindow, kgByVendor, monthlyRates, type RegisterLot } from "./chart-data";

function lot(over: Partial<RegisterLot>): RegisterLot {
  return {
    lotDate: "2026-09-10",
    status: "ok",
    vendorId: "v-kd",
    vendorName: "K.D. Metals",
    scrapItemId: "i-imp",
    itemName: "IMP BELLING",
    partyKgG: 10_000_000,
    ratePaise: 20_000,
    ...over,
  };
}

describe("chartWindow", () => {
  test("six calendar months ending today, by book date", () => {
    expect(chartWindow("2026-10-03")).toEqual({ from: "2026-05-01", to: "2026-10-03", months: ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"] });
    expect(chartWindow("2026-02-14").from).toBe("2025-09-01");
  });
});

describe("monthlyRates", () => {
  const months = chartWindow("2026-10-03").months;

  test("weighted average rupees per kg, per item, for the top items by kg", () => {
    const series = monthlyRates(
      [
        lot({ lotDate: "2026-09-02", partyKgG: 10_000_000, ratePaise: 20_000 }),
        lot({ lotDate: "2026-09-20", partyKgG: 30_000_000, ratePaise: 21_000 }),
        lot({ lotDate: "2026-10-01", partyKgG: 5_000_000, ratePaise: 21_500 }),
        lot({ scrapItemId: "i-soft", itemName: "SOFT CABLE", partyKgG: 8_000_000, ratePaise: 21_400 }),
      ],
      months,
      { maxSeries: 3 },
    );
    expect(series.map((s) => s.key)).toEqual(["i-imp", "i-soft"]);
    const imp = series[0]!;
    expect(imp.label).toBe("IMP BELLING");
    // Sept: (10 t x 200 + 30 t x 210) / 40 t = 207.5; Oct (open month) so far 215.
    expect(imp.points.map((p) => [p.month, p.v, p.partial ?? false])).toEqual([
      ["2026-09", 207.5, false],
      ["2026-10", 215, true],
    ]);
  });

  test("cancelled lots never count; months without lots have no point", () => {
    const [imp] = monthlyRates([lot({ status: "cancelled" }), lot({ lotDate: "2026-06-05" })], months, { maxSeries: 3 });
    expect(imp!.points.map((p) => p.month)).toEqual(["2026-06"]);
  });

  test("keeps only the biggest items", () => {
    const lots = ["a", "b", "c", "d"].map((k, i) =>
      lot({ scrapItemId: k, itemName: k.toUpperCase(), partyKgG: (i + 1) * 1_000_000 }),
    );
    expect(monthlyRates(lots, months, { maxSeries: 3 }).map((s) => s.key)).toEqual(["d", "c", "b"]);
  });
});

describe("kgByVendor", () => {
  test("party kg per vendor, biggest first, with shares that add up", () => {
    const rows = kgByVendor([
      lot({ vendorId: "v-kd", vendorName: "K.D. Metals", partyKgG: 12_450_000 }),
      lot({ vendorId: "v-kd", vendorName: "K.D. Metals", partyKgG: 7_550_000 }),
      lot({ vendorId: "v-gm", vendorName: "Ganesh Metal", partyKgG: 5_000_000 }),
      lot({ vendorId: "v-x", vendorName: "Gone", partyKgG: 9_000_000, status: "cancelled" }),
    ]);
    expect(rows).toEqual([
      { key: "v-kd", label: "K.D. Metals", value: 20_000, share: 80 },
      { key: "v-gm", label: "Ganesh Metal", value: 5_000, share: 20 },
    ]);
  });

  test("nothing bought, no rows", () => {
    expect(kgByVendor([])).toEqual([]);
  });
});
