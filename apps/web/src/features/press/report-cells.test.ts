import { describe, expect, test } from "bun:test";

import { formatterFor, screenPrefs } from "@orrn/domain";
import { createI18n } from "@orrn/i18n";

import { kgGrouped1 } from "@/shared/lib/fmt-text";

import { billetsHeaderKey, reportCell, type ReportCellRow } from "./report-cells";

const IST = { locale: "en", timeZone: "Asia/Kolkata" } as const;
const fmtOf = (p: Parameters<typeof screenPrefs>[0] = {}) => formatterFor(screenPrefs(p), IST);
const row: ReportCellRow = { goodG: 1_000_000, pcs: 120, scrapG: 25_500, billetCount: 6, billetG: 1_200_000, cutLengthsMm: [3658, 4877] };

describe("press report row cells follow the plant", () => {
  test("a plant that changed nothing reads what the server wrote: kg to three decimals, bare mm", () => {
    const f = fmtOf();
    expect(reportCell(f, "good", row)).toBe("1000.000 / 120");
    expect(reportCell(f, "scrap", row)).toBe("25.500");
    expect(reportCell(f, "billets", row)).toBe("6 / 1200.000");
    expect(reportCell(f, "cutLengths", row)).toBe("3658, 4877");
    expect(billetsHeaderKey(f)).toBe("press.report.billets");
  });
  test("a pound plant: the good cell and the totals row under it are the same weight in lb", () => {
    const f = fmtOf({ units: { mass: "lb" } });
    const good = reportCell(f, "good", row);
    expect(good).toBe("2204.62 / 120");
    // the totals row writes the same grams with kgGrouped1
    expect(kgGrouped1(f, row.goodG)).toBe("2,204.6");
    expect(Number(good.split(" / ")[0])).toBeCloseTo(Number(kgGrouped1(f, row.goodG).replace(/,/g, "")), 0);
    expect(reportCell(f, "scrap", row)).toBe("56.22");
    expect(reportCell(f, "billets", row)).toBe("6 / 2645.55");
  });
  test("the billets header names lb on a pound plant (and the sentence carries the unit)", () => {
    const f = fmtOf({ units: { mass: "lb" } });
    const { t } = createI18n("en");
    expect(billetsHeaderKey(f)).toBe("press.report.billetsUnit");
    expect(t(billetsHeaderKey(f), { massUnit: "lb" })).toBe("Billets / lb");
    expect(createI18n("hi").t(billetsHeaderKey(f), { massUnit: "lb" })).toContain("lb");
  });
  test("a metres plant reads each cut with its unit, a feet and inches plant too", () => {
    expect(reportCell(fmtOf({ units: { length: "m" } }), "cutLengths", row)).toBe("3.658 m, 4.877 m");
    expect(reportCell(fmtOf({ units: { length: "ft_in" } }), "cutLengths", row)).toContain("ft");
  });
});
