import { describe, expect, test } from "bun:test";

import { formatterFor, screenPrefs, MM_PER_INCH } from "@orrn/domain";
import { formatLength, formatLengthValue } from "@orrn/server/lib/length";

import { lengthUnitInfo } from "./length";

const IST = { locale: "en", timeZone: "Asia/Kolkata" } as const;
const info = (units: Parameters<typeof screenPrefs>[0] = {}) => lengthUnitInfo(formatterFor(screenPrefs(units), IST));

function mulberry(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

describe("a plant that changed nothing reads lengths as before (old server helper against the new skin)", () => {
  const now = info();
  test("10,000 seeded mm values: formatLength and formatLengthValue are the same text", () => {
    const r = mulberry(7);
    for (let i = 0; i < 10_000; i++) {
      const mm = i < 200 ? i : Math.floor(r() * (i % 5 === 0 ? 40_000 : 13_000));
      expect(now.formatLength(mm)).toBe(formatLength(mm, "mm"));
      expect(now.formatLengthValue(mm)).toBe(formatLengthValue(mm, "mm"));
    }
    expect(now.unit).toBe("mm");
    expect(now.label).toBe("mm");
  });
  test("parsing plain numbers agrees with the old float reader wherever the float reader was right", () => {
    const oldMm = (v: string) => Math.round(parseFloat(v));
    const oldTenth = (v: string) => Math.round(parseFloat(v) * 10) / 10;
    const r = mulberry(11);
    for (let i = 0; i < 5_000; i++) {
      const v = `${Math.floor(r() * 20_000)}${i % 2 ? "" : `.${Math.floor(r() * 10)}`}`;
      expect(now.parseLength(v)).toBe(oldMm(v));
      expect(now.parseLengthDecimal(v)).toBe(oldTenth(v));
    }
  });
  test("regression: 12abc is not 12, and blank is 0", () => {
    expect(now.parseLength("12abc")).toBe(0);
    expect(now.parseLengthDecimal("12abc")).toBe(0);
    expect(now.parseLength("")).toBe(0);
  });
});

describe("a plant that chose feet and inches or metres", () => {
  test("feet and inches: one wording on every screen, not 138.00 in on some and 11 ft 6 in on others", () => {
    const i = info({ units: { length: "ft_in" } });
    expect(i.unit).toBe("inch");
    expect(i.label).toBe("in");
    expect(i.formatLength(3505)).toBe("11 ft 6 in");
    expect(i.formatLength(3658)).toBe("12 ft");
    expect(i.formatLength(152)).toBe("6 in");
    expect(formatLength(3505, "inch")).toBe("137.99 in"); // the old server wording (3505 mm in decimal inches), kept only for the server
    expect(i.parseLength("144")).toBe(3658); // inches typed in the single box
    expect(i.parseLength("322.5")).toBe(8192); // 8191.5 exactly; the float product read 8191
    expect(Math.round(322.5 * MM_PER_INCH)).toBe(8191); // the old float answer, for the record
  });
  test("metres: 3.658 m, typed in metres, label m, entry layout the single box", () => {
    const m = info({ units: { length: "m" } });
    expect(m.unit).toBe("mm");
    expect(m.formatLength(3658)).toBe("3.658 m");
    expect(m.formatLengthValue(3658)).toBe("3.658");
    expect(m.label).toBe("m");
    expect(m.parseLength("3.658")).toBe(3658);
    expect(m.parseLengthDecimal("3.6584")).toBe(3658.4);
  });
  test("international grouping never groups a length", () => {
    expect(info({ number: { grouping: "international" } }).formatLength(12_500)).toBe("12500 mm");
  });
});
