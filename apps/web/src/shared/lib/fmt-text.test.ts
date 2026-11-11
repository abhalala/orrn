/**
 * Parity: every helper the screens used to write numbers and dates by hand, against its replacement under the
 * default preferences. Same values in, same text out, character for character. Seeded, so a failure repeats.
 */
import { describe, expect, test } from "bun:test";

import { formatKg, formatKgTotal, formatterFor, gToKg, kgPerMetre, screenPrefs } from "@orrn/domain";

import { kgText as dieKgText } from "@/features/dies/die-model";
import { kgGroupedText, milliKgText } from "@/features/die-room/die-room-model";
import { dayText as oldDayText, dayTimeText as oldDayTimeText, kgFieldText, listKgText, milliText, orderKgText, pcsText, rateText as oldRateText } from "@/features/orders/format";
import { kgText as purchaseKgText } from "@/features/purchase/format";
import { kgText as reportsKgText, kgWholeText, rupeeText as reportsRupeeText } from "@/features/reports/model";
import { measurementText } from "@/features/dies/die-display";
import { formatBand, kgPerMetreText, wallMmText } from "@/features/die-room/die-room-model";
import { formatQty } from "@/features/store/store-qty";
import { formatKgBand, formatWhen } from "@/features/stock/format";
import { kg12Text } from "@/features/pack/line-preview";
import { formatRupees } from "@/features/today/today-model";

import {
  altSectionText, bandEndText, bandText, geometryWithUnit, kgChartText, kgGrouped0, rupeeScreen, wallWithUnit, countText, dayText, dayTimeText, kgGrouped1, kgGrouped2, kgGrouped3, kgPlain3, kgPlainTrim, kgTrim, lengthUnitText, massUnit, rateText,
  rupeeText, sectionOrNull, sectionText, sectionUnit, whenText,
} from "./fmt-text";

function mulberry(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const IST = { locale: "en", timeZone: "Asia/Kolkata" } as const;
const fmt = formatterFor(screenPrefs({}), IST);
const N = 10_000;

/** Grams: zero, one, tie points at every decimal, small, tens of tonnes, and very large. */
function grams(seed: number): number[] {
  const r = mulberry(seed);
  const out = [0, 1, 5, 10, 49, 50, 51, 99, 100, 499, 500, 501, 999, 1000, 1001, 1005, 1050, 12_345, 99_999, 100_000, 100_005, 12_345_678, 999_999_999];
  while (out.length < N) {
    const scale = [1_000, 100_000, 10_000_000, 1_000_000_000][Math.floor(r() * 4)]!;
    out.push(Math.floor(r() * scale));
  }
  return out;
}

describe("kg text under the default set equals each old helper", () => {
  const values = grams(101);
  test("orderKgText, reports kgText: grouped, 3 decimals", () => {
    for (const g of values) {
      expect(kgGrouped3(fmt, g)).toBe(orderKgText(g));
      expect(kgGrouped3(fmt, g)).toBe(reportsKgText(g));
    }
  });
  test("listKgText and formatKgTotal(gToKg(g)): grouped, 1 decimal", () => {
    for (const g of values) {
      expect(kgGrouped1(fmt, g)).toBe(listKgText(g));
      expect(kgGrouped1(fmt, g)).toBe(formatKgTotal(gToKg(g)));
    }
  });
  test("formatKg(gToKg(g)): grouped, 2 decimals", () => {
    for (const g of values) expect(kgGrouped2(fmt, g)).toBe(formatKg(gToKg(g)));
  });
  test("kgFieldText, milliKgText and milliText: plain, 3 decimals", () => {
    for (const g of values) {
      expect(kgPlain3(fmt, g)).toBe(kgFieldText(g));
      expect(sectionText(fmt, g)).toBe(milliText(g));
      expect(sectionText(fmt, g)).toBe(milliKgText(g));
    }
  });
  test("purchase kgText and kgGroupedText: grouped, zeros dropped", () => {
    for (const g of values) {
      expect(kgTrim(fmt, g)).toBe(purchaseKgText(g));
      expect(kgTrim(fmt, g)).toBe(kgGroupedText(g));
    }
  });
  test("die-model kgText: plain, zeros dropped", () => {
    for (const g of values) expect(kgPlainTrim(fmt, g)).toBe(dieKgText(g));
  });
});

describe("section weight and die bands", () => {
  test("kg12Text equals sectionOrNull over 10,000 values, and null stays null", () => {
    const r = mulberry(3);
    for (let i = 0; i < N; i++) {
      const milli = i < 100 ? i : Math.floor(r() * 100_000);
      expect(sectionOrNull(fmt, milli)).toBe(kg12Text(milli));
    }
    expect(sectionOrNull(fmt, null)).toBeNull();
    expect(kg12Text(null)).toBeNull();
  });
  test("formatKgBand with the default Fmt equals the old call without one", () => {
    const r = mulberry(5);
    for (let i = 0; i < N; i++) {
      const lo = Math.floor(r() * 30_000);
      const hi = i % 7 === 0 ? 0 : lo + Math.floor(r() * 3_000);
      expect(formatKgBand(lo, hi, fmt)).toBe(formatKgBand(lo, hi));
    }
    expect(bandEndText(formatterFor(screenPrefs({ units: { linear_mass: "lb_ft" } }), IST), 2400)).toBe("0.441");
  });
});

describe("rates, counts and rupees", () => {
  test("rateText: rupees per kg, 2 decimals, plain", () => {
    const r = mulberry(7);
    for (let i = 0; i < N; i++) {
      const paise = i < 300 ? i : Math.floor(r() * (i % 3 === 0 ? 5_000_000 : 60_000));
      expect(rateText(fmt, paise)).toBe(oldRateText(paise));
    }
  });
  test("pcsText: whole pieces, grouped", () => {
    const r = mulberry(9);
    for (let i = 0; i < N; i++) {
      const n = i < 200 ? i : Math.floor(r() * (i % 4 === 0 ? 50_000_000 : 5_000));
      expect(countText(fmt, n)).toBe(pcsText(n));
    }
  });
  test("formatRupees: the symbol, grouped, 2 decimals", () => {
    const r = mulberry(13);
    for (let i = 0; i < N; i++) {
      const paise = Math.floor(r() * (i % 4 === 0 ? 900_000_000_000 : 5_000_000));
      expect(fmt.money(paise)).toBe(formatRupees(paise));
    }
    expect(rupeeText(fmt, 123_456_750)).toBe("1234567.50");
  });
});

describe("dates and times under the default set", () => {
  const r = mulberry(21);
  // Instants across 2024 to 2027, including the minutes around midnight IST and year ends.
  const instants = [Date.UTC(2025, 11, 31, 18, 29), Date.UTC(2025, 11, 31, 18, 30), Date.UTC(2026, 0, 1, 0, 0), Date.UTC(2026, 8, 5, 6, 0)];
  while (instants.length < 2000) instants.push(Date.UTC(2024, 0, 1) + Math.floor(r() * 3 * 365 * 24 * 3600 * 1000));
  const now = Date.UTC(2026, 10, 10, 9, 0);
  test("stock formatWhen: '3 Oct, 14:20', with the year outside the current year", () => {
    for (const at of instants) {
      expect(whenText(fmt, at, now)).toBe(formatWhen(at, { locale: "en", timeZone: "Asia/Kolkata", now }));
    }
  });
  test("orders dayTimeText: '24 Oct at 20:00' (the joiner is Intl's own, so it matches wherever the test runs)", () => {
    for (const at of instants) expect(dayTimeText(fmt, at)).toBe(oldDayTimeText(at, "en", "Asia/Kolkata"));
  });
  test("orders dayText: '25 Oct' from a calendar day", () => {
    for (let i = 0; i < 800; i++) {
      const d = new Date(Date.UTC(2024, 0, 1) + i * 86_400_000);
      const ymd = d.toISOString().slice(0, 10);
      expect(dayText(fmt, ymd)).toBe(oldDayText(ymd, "en"));
    }
    expect(dayText(fmt, "not a day")).toBe("not a day");
  });
});

describe("hindi dates under the default set", () => {
  const hi = formatterFor(screenPrefs({}), { locale: "hi", timeZone: "Asia/Kolkata" });
  const now = Date.UTC(2026, 10, 10, 9, 0);
  test("stock formatWhen and orders dayText agree in Hindi", () => {
    const r = mulberry(33);
    for (let i = 0; i < 500; i++) {
      const at = Date.UTC(2024, 0, 1) + Math.floor(r() * 3 * 365 * 24 * 3600 * 1000);
      expect(whenText(hi, at, now)).toBe(formatWhen(at, { locale: "hi", timeZone: "Asia/Kolkata", now }));
      const ymd = new Date(at).toISOString().slice(0, 10);
      expect(dayText(hi, ymd)).toBe(oldDayText(ymd, "hi"));
    }
  });
});

describe("units in labels and headers", () => {
  test("default: kg, kg/12ft, mm", () => {
    expect(massUnit(fmt)).toBe("kg");
    expect(sectionUnit(fmt)).toBe("kg/12ft");
    expect(lengthUnitText(fmt)).toBe("mm");
  });
  test("a plant on pounds, lb per foot, feet and inches", () => {
    const f = formatterFor(screenPrefs({ units: { mass: "lb", linear_mass: "lb_ft", length: "ft_in" } }), IST);
    expect(massUnit(f)).toBe("lb");
    expect(sectionUnit(f)).toBe("lb/ft");
    expect(lengthUnitText(f)).toBe("ft in");
    expect(kgGrouped3(f, 123_456_789)).toBe("2,72,175.63"); // Indian grouping stays unless the plant changes it
    expect(kgGrouped1(f, 123_456_789)).toBe("2,72,175.6");
    expect(sectionText(f, 2090)).toBe("0.384");
  });
  test("international grouping groups weights and not lengths", () => {
    const f = formatterFor(screenPrefs({ number: { grouping: "international" } }), IST);
    expect(kgGrouped3(f, 123_456_789)).toBe("123,456.789");
    expect(countText(f, 1_234_567)).toBe("1,234,567");
    expect(rupeeText(f, 123_456_750)).toBe("1234567.50");
  });
  test("12 hour clock and month first change the when text", () => {
    const f = formatterFor(screenPrefs({ clock: "h12", date: { order: "mdy" } }), IST);
    expect(whenText(f, Date.UTC(2026, 10, 10, 14, 5), Date.UTC(2026, 10, 10))).toBe("Nov 10, 7:35 pm");
    expect(dayText(f, "2026-10-25")).toBe("Oct 25");
  });
});

describe("more shapes under the default set", () => {
  const values = grams(77);
  test("kgWholeText, reports rupeeText, chart labels", () => {
    for (const g of values) {
      expect(kgGrouped0(fmt, g)).toBe(kgWholeText(g));
      expect(kgChartText(fmt, g / 1000)).toBe(`${formatKgTotal(g / 1000)} kg`);
    }
    expect(kgChartText(fmt, 0, true)).toBe("0 kg");
    const r = mulberry(8);
    for (let i = 0; i < N; i++) {
      const paise = Math.floor(r() * (i % 3 === 0 ? 900_000_000_000 : 9_000_000));
      expect(rupeeScreen(fmt, paise)).toBe(reportsRupeeText(paise));
    }
  });
  test("die bands, walls, measurements", () => {
    const r = mulberry(12);
    for (let i = 0; i < N; i++) {
      const lo = Math.floor(r() * 30_000);
      const hi = lo + Math.floor(r() * 3_000);
      expect(bandText(fmt, lo, hi)).toBe(formatBand(lo, hi, "kg/12ft"));
      expect(formatBand(lo, hi, "kg/12ft", fmt)).toBe(formatBand(lo, hi, "kg/12ft"));
      const tenth = 1 + Math.floor(r() * 400);
      expect(wallWithUnit(fmt, tenth)).toBe(`${wallMmText(tenth)} mm`);
      const mm = Math.floor(r() * 6000) / (i % 2 ? 10 : 1);
      expect(geometryWithUnit(fmt, mm)).toBe(measurementText(mm, "mm", { mm: "mm", inch: "in" }));
    }
  });
  test("the second section weight: kg per metre beside kg per 12 ft", () => {
    const r = mulberry(14);
    for (let i = 0; i < N; i++) {
      const milli = 500 + Math.floor(r() * 30_000);
      expect(altSectionText(fmt, milli)).toBe(`${kgPerMetreText(kgPerMetre(milli))} kg/m`);
    }
    const lb = formatterFor(screenPrefs({ units: { linear_mass: "lb_ft" } }), IST);
    expect(altSectionText(lb, 2090)).toBe("2.090 kg/12ft");
  });
  test("store quantities of kilogram items: formatQty with the formatter equals the old one", () => {
    for (const g of values) expect(formatQty(g, "kg", fmt)).toBe(formatQty(g));
    expect(formatQty(12_500, "litre", fmt)).toBe("12.5");
    const lb = formatterFor(screenPrefs({ units: { mass: "lb" } }), IST);
    expect(formatQty(12_500, "kg", lb)).toBe("27.56");
    expect(formatQty(12_500, "litre", lb)).toBe("12.5");
  });
});
