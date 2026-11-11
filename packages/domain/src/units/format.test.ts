import { describe, expect, test } from "bun:test";

import { toCanonical } from "./canonical";
import { formatCompact, formatFtIn, formatStorage, formatterFor, formatCompact as compact } from "./format";
import { ORRN_DEFAULT_PREFS, LEGACY_DOC_UNITS, screenPrefs } from "./prefs";
import { DEFAULT_NUMBER_STYLE, groupDigits, writeScaled } from "./style";
import { randInt, rng } from "./test-support";
import { bpPercent1 } from "../pressRun";
import { kgPerMetre, kgPerMetreToG12ft } from "../drift";
import { percentToPpm } from "../foundry";
import { tolerancePercentText } from "../packDispatch";
import { formatCompactIN, formatKg, formatKgTotal, formatLength, lengthFromInput } from "../units";

const IN = DEFAULT_NUMBER_STYLE;
const PLAIN = { grouping: "none", decimal: ".", group: "," } as const;
const IST = { locale: "en", timeZone: "Asia/Kolkata" } as const;

describe("number writer", () => {
  test("Indian and international grouping", () => {
    expect(groupDigits("1234567", IN)).toBe("12,34,567");
    expect(groupDigits("123456789", IN)).toBe("12,34,56,789");
    expect(groupDigits("999", IN)).toBe("999");
    expect(groupDigits("1234567", { ...IN, grouping: "international" })).toBe("1,234,567");
    expect(groupDigits("1234567", { ...IN, grouping: "none" })).toBe("1234567");
    expect(groupDigits("1234567", { grouping: "international", decimal: ",", group: "." })).toBe("1.234.567");
  });
  test("decimal mark, trim, sign, no minus zero", () => {
    expect(writeScaled(123456750n, 2, IN)).toBe("12,34,567.50");
    expect(writeScaled(123456750n, 2, IN, { trim: true })).toBe("12,34,567.5");
    expect(writeScaled(5n, 2, IN)).toBe("0.05");
    expect(writeScaled(-5n, 2, IN)).toBe("-0.05");
    expect(writeScaled(0n, 2, { ...IN, decimal: "," })).toBe("0,00");
    expect(writeScaled(-0n, 3, IN)).toBe("0.000");
    expect(writeScaled(1200n, 3, IN, { trim: true, minDecimals: 1 })).toBe("1.2");
    expect(writeScaled(1000n, 3, IN, { trim: true, minDecimals: 1 })).toBe("1.0");
  });
  test("a value that rounds to zero from below carries no sign", () => {
    expect(formatStorage(-1, "g", "kg", 2, IN)).toBe("0.00");
    expect(formatStorage(-6, "g", "kg", 2, IN)).toBe("-0.01");
  });
});

describe("formatters reproduce today's output, 10,000 seeded values each", () => {
  const N = 10_000;
  test("kg at 2 places is formatKg, kg total at 1 place is formatKgTotal", () => {
    const r = rng(101);
    for (let i = 0; i < N; i++) {
      const g = randInt(r, 0, i % 3 === 0 ? 4_000_000_000 : 200_000);
      expect(formatStorage(g, "g", "kg", 2, IN)).toBe(formatKg(g / 1000));
      expect(formatStorage(g, "g", "kg", 1, IN)).toBe(formatKgTotal(g / 1000));
      expect(formatStorage(g, "g", "kg", 3, IN)).toBe(formatKg(g / 1000, 3));
    }
  });
  test("mm and inches match domain formatLength", () => {
    const r = rng(102);
    for (let i = 0; i < N; i++) {
      const mm = randInt(r, 0, 60_000);
      expect(formatStorage(mm, "mm", "mm", 0, PLAIN) + " mm").toBe(formatLength(mm, "mm"));
      expect(formatFtIn(mm, 4, IN)).toBe(formatLength(mm, "inch"));
    }
  });
  test("compact numbers match formatCompactIN", () => {
    const r = rng(103);
    const bad: string[] = [];
    for (let i = 0; i < N; i++) {
      const mag = 10 ** randInt(r, 0, 10);
      const v = Math.floor(r() * mag * 10) / 10 * (i % 7 === 0 ? -1 : 1);
      const want = formatCompactIN(v);
      const got = compact(v, "indian", IN);
      if (want !== got) bad.push(`${v}: ${want} vs ${got}`);
    }
    expect(bad).toEqual([]);
  });
  test("bp as a one-decimal percent matches bpPercent1; tolerance text matches tolerancePercentText", () => {
    const r = rng(104);
    for (let i = 0; i < N; i++) {
      const bp = randInt(r, -100_000, 100_000);
      expect(formatStorage(bp, "bp", "pct", 1, PLAIN)).toBe(bpPercent1(bp));
      const pos = Math.abs(bp);
      expect(formatStorage(pos, "bp", "pct", 2, PLAIN, { trim: true })).toBe(tolerancePercentText(pos));
    }
  });
  test("kg/12ft thousandths in kg/m matches kgPerMetre; kg/m typed matches kgPerMetreToG12ft", () => {
    const r = rng(105);
    for (let i = 0; i < N; i++) {
      const milli = randInt(r, 0, 60_000);
      expect(formatStorage(milli, "g_12ft", "kg_m", 3, PLAIN)).toBe(kgPerMetre(milli).toFixed(3));
      const kgm = `${randInt(r, 0, 20)}.${String(randInt(r, 0, 999)).padStart(3, "0")}`;
      const got = toCanonical("die.band", kgm, "kg_m");
      expect(got.ok && got.value).toBe(kgPerMetreToG12ft(Number(kgm)));
    }
  });
  test("percent text to ppm matches percentToPpm", () => {
    const r = rng(106);
    for (let i = 0; i < N; i++) {
      const dec = randInt(r, 0, 4);
      const text = dec === 0 ? String(randInt(r, 0, 99)) : `${randInt(r, 0, 99)}.${String(randInt(r, 0, 10 ** dec - 1)).padStart(dec, "0")}`;
      const got = toCanonical("foundry.fraction", text, "pct");
      expect(got.ok && got.value).toBe(percentToPpm(text) ?? -1);
    }
  });
  test("rupees match the web's formatRupees", () => {
    const f = formatterFor(ORRN_DEFAULT_PREFS, IST);
    const legacy = (paise: number) =>
      `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const r = rng(107);
    for (let i = 0; i < N; i++) {
      const paise = randInt(r, 0, i % 4 === 0 ? 900_000_000_000 : 5_000_000);
      expect(f.money(paise)).toBe(legacy(paise));
    }
  });
  test("feet and inches typed on the quarter grid match lengthFromInput", () => {
    const bad: string[] = [];
    for (let feet = 0; feet <= 40; feet++) {
      for (let q = 0; q < 48; q++) {
        const inches = q / 4;
        const want = lengthFromInput({ unit: "inch", feet: String(feet), inches: String(inches) });
        const got = toCanonical("bundle.length", `${feet} ft ${inches} in`, "ft_in", { mode: "round" });
        if (want !== null && (!got.ok || got.value !== want)) bad.push(`${feet} ft ${inches} in: old ${want}, new ${got.ok ? got.value : got.problem}`);
      }
    }
    // One exact half-millimetre tie on the whole grid. 322.5 in x 25.4 is exactly 8191.5 mm; the old float maths
    // reads 8191.499999999999 and rounds down, the exact path rounds half away from zero. Confirmed defect, see UNITS-A-REPORT.md.
    expect(bad).toEqual(["26 ft 10.5 in: old 8191, new 8192"]);
  });
});

describe("formatFtIn", () => {
  test("golden cases", () => {
    expect(formatFtIn(3810, 4, IN)).toBe("12 ft 6 in");
    expect(formatFtIn(3658, 4, IN)).toBe("12 ft");
    expect(formatFtIn(159, 4, IN)).toBe("6.25 in");
    expect(formatFtIn(3512, 4, IN)).toBe("11 ft 6.25 in");
    expect(formatFtIn(3512, 4, IN, { fraction: true })).toBe("11 ft 6 1/4 in");
    expect(formatFtIn(3512, 16, IN, { fraction: true })).toBe("11 ft 6 1/4 in");
    expect(formatFtIn(3811, 16, IN, { fraction: true })).toBe("12 ft 6 1/16 in");
    expect(formatFtIn(3811, 16, IN)).toBe("12 ft 6.0625 in");
    expect(formatFtIn(3811, 8, IN)).toBe("12 ft 6 in");
    expect(formatFtIn(0, 4, IN)).toBe("0 in");
    expect(formatFtIn(5486, 4, IN)).toBe("18 ft");
    expect(formatFtIn(-3810, 4, IN)).toBe("-12 ft 6 in");
    expect(formatFtIn(Number.NaN, 4, IN)).toBe("-");
  });
  test("what is shown reads back the same text (format, parse, format) on every grid", () => {
    const r = rng(108);
    const f16 = formatterFor({ ...ORRN_DEFAULT_PREFS, units: { ...ORRN_DEFAULT_PREFS.units, length: "ft_in" } }, IST);
    for (let i = 0; i < 4000; i++) {
      const mm = randInt(r, 0, 30_000);
      const text = f16.entryText("bundle.length", mm);
      const back = f16.parse("bundle.length", text);
      expect([mm, text, back.ok]).toEqual([mm, text, true]);
      if (back.ok) expect(f16.entryText("bundle.length", back.value)).toBe(text);
    }
  });
});

describe("formatterFor", () => {
  const f = formatterFor(ORRN_DEFAULT_PREFS, IST);
  test("kg for a bundle, in each context", () => {
    expect(f.q("bundle.weight", 52_437)).toBe("52.437 kg");
    expect(f.q("bundle.weight", 52_437, "print")).toBe("52.44 kg");
    expect(f.q("bundle.weight", 52_437, "total")).toBe("52.4 kg");
    expect(f.n("bundle.weight", 5_243_700, "screen")).toBe("5,243.700");
    expect(f.n("bundle.weight", 5_243_700, "export")).toBe("5243.700");
    expect(f.entryText("bundle.weight", 52_400)).toBe("52.4");
    expect(f.q("bundle.weight", null)).toBe("-");
    expect(f.q("bundle.weight", undefined)).toBe("-");
    expect(f.q("bundle.weight", Number.NaN)).toBe("-");
    expect(f.q("bundle.weight", Infinity)).toBe("-");
  });
  test("other kinds at the default set", () => {
    expect(f.q("bundle.length", 3658)).toBe("3,658 mm");
    expect(f.q("die.band", 2090)).toBe("2.090 kg/12ft");
    expect(f.q("order.rate", 25_000)).toBe("₹250.00/kg");
    expect(f.q("customer.tolerance", 250)).toBe("2.5%");
    expect(f.q("foundry.fraction", 4500)).toBe("0.450%");
    expect(f.q("ageing.temperature", 1853)).toBe("185.3 °C");
    expect(f.q("bundle.pieces", 21)).toBe("21 pcs");
    expect(f.money(123456750)).toBe("₹12,34,567.50");
    expect(f.header("Weight", "mass")).toBe("Weight (kg)");
    expect(f.header("Rate", "money_per_mass")).toBe("Rate (₹/kg)");
    expect(f.unitOf("mass").id).toBe("kg");
  });
  test("a stray non-integer reads as the decimal it prints as", () => {
    expect(f.n("bundle.weight", 52_437.5)).toBe("52.438");
  });
  test("pounds, tonnes, kg/m and lb/ft", () => {
    const g = screenPrefs({ units: { mass: "lb", linear_mass: "lb_ft", length: "m" } });
    const fg = formatterFor(g, IST);
    expect(fg.q("bundle.weight", 52_437)).toBe("115.60 lb");
    expect(fg.q("die.band", 2090)).toBe("0.384 lb/ft");
    expect(fg.q("bundle.length", 3658)).toBe("3.658 m");
    expect(fg.parse("bundle.weight", "115.6")).toMatchObject({ ok: true, value: 52_435 });
    const t = formatterFor(screenPrefs({ units: { mass: "t" } }), IST);
    expect(t.q("order.weight", 12_345_678)).toBe("12.346 t");
    expect(t.entryText("order.weight", 12_345_678)).toBe("12.345678");
  });
  test("international grouping, decimal comma, rupee symbol and compact scale", () => {
    const p = screenPrefs({
      number: { grouping: "international" },
      currency: { symbol: "Rs", compact: "international" },
    });
    const fi = formatterFor(p, IST);
    expect(fi.n("order.weight", 1_234_567_890)).toBe("1,234,567.890");
    expect(fi.money(123456750)).toBe("Rs 1,234,567.50");
    expect(fi.compact(1_200_000)).toBe("1.2M");
    const eu = formatterFor(screenPrefs({ number: { grouping: "international", decimal: ",", group: "." } }), IST);
    expect(eu.n("order.weight", 1_234_567_890)).toBe("1.234.567,890");
    expect(eu.parse("order.weight", "1.234.567,89")).toMatchObject({ ok: true, value: 1_234_567_890 });
    const ci = formatterFor(screenPrefs({ currency: { symbol: "INR" } }), IST);
    expect(ci.q("order.rate", 25_000)).toBe("INR 250.00/kg");
  });
  test("precision override", () => {
    const p = screenPrefs({ precision: { "mass.screen": 1 } });
    expect(formatterFor(p, IST).q("bundle.weight", 52_437)).toBe("52.4 kg");
  });
  test("memoised by the resolved set", () => {
    expect(formatterFor(screenPrefs({}), IST)).toBe(f);
    expect(formatterFor(ORRN_DEFAULT_PREFS, { locale: "hi", timeZone: "Asia/Kolkata" })).not.toBe(f);
  });
  test("compact tiers", () => {
    expect(f.compact(950)).toBe("950");
    expect(f.compact(12_000)).toBe("12k");
    expect(f.compact(120_000)).toBe("1.2L");
    expect(f.compact(11_000_000)).toBe("1.1Cr");
    expect(f.compact(99_990)).toBe("1L");
    expect(f.compact(-120_000)).toBe("-1.2L");
    expect(f.compact(Number.NaN)).toBe("");
    expect(formatCompact(999.6, "indian", IN)).toBe("1k");
  });
  test("the legacy document set reads like today's packing list", () => {
    const l = formatterFor(LEGACY_DOC_UNITS, IST);
    expect(l.q("bundle.weight", 52_437, "print")).toBe("52.44 kg");
    expect(l.q("bundle.length", 3512, "print")).toBe("11 ft 6.25 in");
    expect(l.q("die.band", 2090, "print")).toBe("2.090 kg/12ft");
  });
});

describe("dates and times", () => {
  // 2026-11-10 19:00 UTC is 2026-11-11 00:30 in Kolkata and 14:00 on 10 Nov in New York
  const at = Date.UTC(2026, 10, 10, 19, 0);
  test("the plant's zone decides the day, never the device", () => {
    const kol = formatterFor(ORRN_DEFAULT_PREFS, IST);
    const ny = formatterFor(ORRN_DEFAULT_PREFS, { locale: "en", timeZone: "America/New_York" });
    expect(kol.date(at)).toBe("11 Nov 2026");
    expect(ny.date(at)).toBe("10 Nov 2026");
    expect(kol.time(at)).toBe("00:30");
    expect(ny.time(at)).toBe("14:00");
  });
  test("order, month style and clock", () => {
    const mdy = formatterFor(screenPrefs({ date: { order: "mdy" }, clock: "h12" }), IST);
    expect(mdy.date(at)).toBe("Nov 11, 2026");
    expect(mdy.time(at)).toBe("12:30 am");
    expect(mdy.time(Date.UTC(2026, 10, 10, 9, 5))).toBe("2:35 pm");
    expect(mdy.time(Date.UTC(2026, 10, 10, 6, 30))).toBe("12:00 pm");
    const num = formatterFor(screenPrefs({ date: { order: "dmy", month: "numeric" } }), IST);
    expect(num.date(at)).toBe("11/11/2026");
    expect(num.date(at, { year: false })).toBe("11/11");
    const ymd = formatterFor(screenPrefs({ date: { order: "ymd", month: "numeric" } }), IST);
    expect(ymd.date(at)).toBe("2026-11-11");
    expect(formatterFor(screenPrefs({ date: { order: "ymd" } }), IST).date(at)).toBe("2026 Nov 11");
  });
  test("a production day has no zone shift; junk gives the empty text", () => {
    const f = formatterFor(ORRN_DEFAULT_PREFS, { locale: "en", timeZone: "Pacific/Kiritimati" });
    expect(f.day("2026-11-10")).toBe("10 Nov 2026");
    expect(f.date("2026-11-10")).toBe("10 Nov 2026");
    expect(f.day("10/11/2026")).toBe("-");
    expect(f.date(Number.NaN)).toBe("-");
    expect(formatterFor(ORRN_DEFAULT_PREFS, { locale: "en", timeZone: "Not/AZone" }).date(at)).toBe("-");
  });
  test("the other languages give a month name but Latin digits", () => {
    const hi = formatterFor(ORRN_DEFAULT_PREFS, { locale: "hi", timeZone: "Asia/Kolkata" });
    expect(hi.date(at)).toMatch(/^11 \D+ 2026$/);
    const gu = formatterFor(ORRN_DEFAULT_PREFS, { locale: "gu", timeZone: "Asia/Kolkata" });
    expect(gu.date(at)).toMatch(/^11 \D+ 2026$/);
  });
});
