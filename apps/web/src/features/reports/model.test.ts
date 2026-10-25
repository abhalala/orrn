import { describe, expect, test } from "bun:test";

import { en, type MessageKey } from "@orrn/i18n/en";

import {
  bpText,
  csvFileName,
  dieLifeCsv,
  kgText,
  lifeChip,
  lifeHeader,
  lifeTone,
  monthText,
  ordersCsv,
  ordersRowName,
  orderMonthBars,
  recoveryBars,
  recoveryCsv,
  recoveryLabel,
  rupeeText,
  stockAgeBars,
  stockAgeCsv,
  stockAgeRowName,
  toCsv,
  type DieLifeItem,
  type OrdersData,
  type RecoveryData,
  type StockAgeData,
} from "./model";
import { parseDieLifeSearch, parseOrdersReportSearch, parseProductionSearch, parseStockAgeSearch } from "./search";

/** English `t` over the real dictionary (with `{var}` and `{count:a|b}`), so a missing key fails here. */
function t(key: MessageKey, vars: Record<string, unknown> = {}): string {
  const raw = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], en);
  if (typeof raw !== "string") throw new Error(`missing ${key}`);
  return raw
    .replace(/\{(\w+):([^|}]*)\|([^}]*)\}/g, (_, v, one, other) => (Number(vars[v]) === 1 ? one : other))
    .replace(/\{(\w+)\}/g, (_, v) => String(vars[v] ?? `{${v}}`));
}

const recovery: RecoveryData = {
  groupBy: "die",
  rows: [
    { key: "s1", label: "12170", detail: "Domal", runs: 1, inputG: 310_400, goodG: 234_200, scrapG: 44_800, recoveryBp: 7545, recoveryPct: "75.5" },
    { key: "s2", label: "4521", detail: null, runs: 1, inputG: 200_000, goodG: 180_000, scrapG: 18_000, recoveryBp: 9000, recoveryPct: "90.0" },
    { key: "s3", label: "13090", detail: "Tee", runs: 1, inputG: 0, goodG: 0, scrapG: 0, recoveryBp: null, recoveryPct: null },
  ],
  totals: { runs: 3, inputG: 510_400, goodG: 414_200, scrapG: 62_800, recoveryBp: 8115, recoveryPct: "81.2" },
};

describe("formatting", () => {
  test("kg, rupees, percents from the server's integers", () => {
    expect(kgText(1_280_000)).toBe("1,280.000");
    expect(kgText(234_200)).toBe("234.200");
    expect(rupeeText(30_000_000)).toBe("3,00,000.00");
    expect(bpText(7545)).toBe("75.5");
    expect(bpText(588)).toBe("5.9");
    expect(bpText(null)).toBe("");
    expect(monthText("2026-09")).toBe("Sep 2026");
    expect(monthText("junk")).toBe("junk");
  });

  test("CSV cells are quoted when they hold a comma, quote or newline; file names carry the days", () => {
    expect(toCsv(["a", "b,c"], [["x \"y\"", 1]])).toBe('a,"b,c"\n"x ""y""",1\n');
    expect(csvFileName("recovery", "2026-10-24", "2026-10-24")).toBe("recovery-2026-10-24.csv");
    expect(csvFileName("recovery", "2026-10-01", "2026-10-24")).toBe("recovery-2026-10-01-2026-10-24.csv");
    expect(csvFileName("die-life")).toBe("die-life.csv");
  });
});

describe("recovery", () => {
  test("labels, bars and CSV use the server's figures; rows with no input have no bar", () => {
    expect(recoveryLabel(recovery.rows[0]!, "die", t)).toBe("12170 Domal");
    expect(recoveryLabel({ label: "", detail: null }, "copy", t)).toBe("None");
    expect(recoveryBars(recovery, t).map((b) => [b.key, b.value])).toEqual([
      ["s1", 75.5],
      ["s2", 90],
    ]);
    const csv = recoveryCsv(recovery, t).trim().split("\n");
    expect(csv[0]).toBe('Die,Runs,Billets kg,Good kg,"Butt, ends and rejects kg",Recovery %');
    expect(csv[1]).toBe("12170 Domal,1,310.400,234.200,44.800,75.5");
    expect(csv[3]).toBe("13090 Tee,1,0.000,0.000,0.000,");
    expect(csv[4]).toBe("Total,3,510.400,414.200,62.800,81.2");
  });
});

const lifeItem = (over: Partial<DieLifeItem>): DieLifeItem => ({
  dieInstanceId: "c1",
  code: "12170-1",
  status: "in_use",
  sectionId: "s1",
  sectionCode: "12170",
  sectionName: "Domal",
  lifeG: 60_000_000,
  producedG: 56_820_000,
  runs: 42,
  lastRunDay: "2026-10-22",
  usedBp: 9470,
  usedPct: "94.7",
  remainingG: 3_180_000,
  state: "near",
  reached: false,
  ...over,
});

describe("die life", () => {
  test("chip, tone and the card header", () => {
    expect(lifeChip(lifeItem({}), t)).toBe("94.7 % used");
    expect(lifeTone("near")).toBe("amber");
    expect(lifeChip(lifeItem({ state: "reached", usedPct: "120.0" }), t)).toBe("Life reached · 120.0 % used");
    expect(lifeTone("reached")).toBe("red");
    expect(lifeChip(lifeItem({ state: "none", usedPct: null, lifeG: null }), t)).toBe("No life set");
    expect(lifeTone("none")).toBe("neutral");
    expect(lifeHeader(lifeItem({}), t)).toBe("Life: 94.7 % used, 56,820 of 60,000 kg pressed");
    expect(lifeHeader(lifeItem({ lifeG: null, usedPct: null, state: "none" }), t)).toBe("No life set for this copy. Pressed so far: 56,820 kg");
  });

  test("CSV: one row per copy with blank life cells when none is set", () => {
    const csv = dieLifeCsv([lifeItem({}), lifeItem({ code: "4521-2", sectionName: null, sectionCode: "4521", lifeG: null, usedPct: null, remainingG: null, state: "none", lastRunDay: null })], t, (s) => `[${s}]`)
      .trim()
      .split("\n");
    expect(csv[0]).toBe("Die copy,Section,Status,Life kg,Pressed kg,Used,Left kg,Runs,Last run");
    expect(csv[1]).toBe("12170-1,12170 Domal,[in_use],60000.000,56820.000,94.7,3180.000,42,2026-10-22");
    expect(csv[2]).toBe("4521-2,4521,[in_use],,56820.000,,,42,");
  });
});

const age: StockAgeData = {
  asOf: "2026-10-20T06:30:00.000Z",
  today: "2026-10-20",
  buckets: [
    { key: "0-7", minDays: 0, maxDays: 7, bundles: 2, kgG: 203_000 },
    { key: "8-30", minDays: 8, maxDays: 30, bundles: 2, kgG: 304_000 },
    { key: "31-90", minDays: 31, maxDays: 90, bundles: 2, kgG: 405_000 },
    { key: "90+", minDays: 91, maxDays: null, bundles: 2, kgG: 308_000 },
  ],
  rows: [
    { customerId: null, customerName: null, buckets: [{ bundles: 0, kgG: 0 }, { bundles: 1, kgG: 201_000 }, { bundles: 2, kgG: 405_000 }, { bundles: 1, kgG: 204_000 }], bundles: 4, kgG: 810_000 },
    { customerId: "p1", customerName: "Bhavesh Traders", buckets: [{ bundles: 2, kgG: 203_000 }, { bundles: 1, kgG: 103_000 }, { bundles: 0, kgG: 0 }, { bundles: 1, kgG: 104_000 }], bundles: 4, kgG: 410_000 },
  ],
  totals: { bundles: 8, kgG: 1_220_000 },
  over90: { bundles: 2, kgG: 308_000 },
};

describe("stock age", () => {
  test("plant stock row, ordinal bars in kg, CSV with kg and bundles per bucket", () => {
    expect(stockAgeRowName(age.rows[0]!, t)).toBe("Plant stock");
    expect(stockAgeRowName(age.rows[1]!, t)).toBe("Bhavesh Traders");
    expect(stockAgeRowName({ customerId: "x", customerName: null }, t)).toBe("Party not found");
    expect(stockAgeBars(age, t).map((b) => [b.label, b.value])).toEqual([
      ["0 to 7 days", 203],
      ["8 to 30 days", 304],
      ["31 to 90 days", 405],
      ["Over 90 days", 308],
    ]);
    const csv = stockAgeCsv(age, t).trim().split("\n");
    expect(csv[0]).toBe(
      "Party,0 to 7 days kg,0 to 7 days Bundles,8 to 30 days kg,8 to 30 days Bundles,31 to 90 days kg,31 to 90 days Bundles,Over 90 days kg,Over 90 days Bundles,Total kg,Total Bundles",
    );
    expect(csv[1]).toBe("Plant stock,0.000,0,201.000,1,405.000,2,204.000,1,810.000,4");
    expect(csv[3]).toBe("Total,203.000,2,304.000,2,405.000,2,308.000,2,1220.000,8");
  });
});

const orders: OrdersData = {
  groupBy: "month",
  rows: [
    { key: "2026-10", label: "2026-10", orders: 2, openOrders: 2, lateOrders: 0, lines: 3, orderedG: 1_920_000, dispatchedG: 120_000, bakiG: 1_800_000, excessG: 0, dispatchedBp: 625, rates: { orderedValuePaise: 30_000_000, dispatchedValuePaise: 3_000_000, bakiValuePaise: 27_000_000, rateMissingLines: 2 } },
    { key: "2026-09", label: "2026-09", orders: 1, openOrders: 1, lateOrders: 1, lines: 1, orderedG: 240_000, dispatchedG: 0, bakiG: 240_000, excessG: 0, dispatchedBp: 0, rates: { orderedValuePaise: 0, dispatchedValuePaise: 0, bakiValuePaise: 0, rateMissingLines: 1 } },
  ],
  sum: { orders: 3, openOrders: 3, lateOrders: 1, lines: 4, orderedG: 2_160_000, dispatchedG: 120_000, bakiG: 2_040_000, excessG: 0, dispatchedBp: 556 },
  totals: {} as OrdersData["totals"],
  rateTotals: { orderedValuePaise: 30_000_000, dispatchedValuePaise: 3_000_000, bakiValuePaise: 27_000_000, rateMissingLines: 3 },
  ratesAllowed: true,
};

describe("order book report", () => {
  test("month names, chart oldest first, CSV with rupees only when asked", () => {
    expect(ordersRowName(orders.rows[0]!, "month")).toBe("Oct 2026");
    expect(ordersRowName({ key: "p1", label: "Bhavesh Traders" }, "customer")).toBe("Bhavesh Traders");
    expect(orderMonthBars(orders).map((b) => [b.label, b.value])).toEqual([
      ["Sep 2026", 240],
      ["Oct 2026", 1920],
    ]);
    const plain = ordersCsv(orders, t, false).trim().split("\n");
    expect(plain[0]).toBe("Order month,Orders,Late,Ordered kg,Dispatched kg,Baki kg,Dispatched %");
    expect(plain[1]).toBe("Oct 2026,2,0,1920.000,120.000,1800.000,6.3");
    expect(plain[3]).toBe("Total,3,1,2160.000,120.000,2040.000,5.6");
    expect(plain.join("\n")).not.toContain("Rs");
    const priced = ordersCsv(orders, t, true).trim().split("\n");
    expect(priced[0]).toEndWith(",Ordered Rs,Dispatched Rs,Baki Rs");
    expect(priced[1]).toEndWith(",300000.00,30000.00,270000.00");
    expect(priced[3]).toEndWith(",300000.00,30000.00,270000.00");
  });
});

describe("search params", () => {
  test("production keeps the press report filters plus the group", () => {
    expect(parseProductionSearch({ from: "2026-10-24", to: "x", shift: "2", line: "l1", group: "shift" })).toEqual({ from: "2026-10-24", shift: 2, line: "l1", group: "shift" });
    expect(parseProductionSearch({ group: "nope" })).toEqual({});
  });
  test("die life, stock age and orders", () => {
    expect(parseDieLifeSearch({ all: "true", retired: "0" })).toEqual({ all: true });
    expect(parseStockAgeSearch({ plant: "1", party: "p1" })).toEqual({ plant: true });
    expect(parseStockAgeSearch({ party: "p1" })).toEqual({ party: "p1" });
    expect(parseOrdersReportSearch({ group: "month", party: "p1", late: "true", from: "2026-09-01", to: "bad", rates: true })).toEqual({
      group: "month",
      party: "p1",
      late: true,
      from: "2026-09-01",
      rates: true,
    });
  });
});
