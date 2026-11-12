import { describe, expect, test } from "bun:test";

import { formatterFor, screenPrefs } from "@orrn/domain";

import { copyBandCell } from "./copy-band";

const IST = { locale: "en", timeZone: "Asia/Kolkata" } as const;
const plant = (units: Record<string, string>) => formatterFor(screenPrefs({ units }), IST);

// What `dieInstance.list` sends for a copy whose band is 2.300 to 2.500 kg per 12 ft.
const COPY = { bandText: "2.300-2.500", bandMinG: 2300, bandMaxG: 2500 };

describe("the die room board's copy band follows the plant's section unit", () => {
  test("a plant that changed nothing reads the server's text and kg/12ft, character for character", () => {
    expect(copyBandCell(COPY, plant({}))).toBe("2.300-2.500 kg/12ft");
  });
  test("a kg per metre plant reads the band in kg/m, not the kg/12ft figures under a new word", () => {
    expect(copyBandCell(COPY, plant({ linear_mass: "kg_m" }))).toBe("0.629-0.684 kg/m");
  });
  test("a lb per foot plant reads the band in lb/ft", () => {
    const text = copyBandCell(COPY, plant({ linear_mass: "lb_ft" }));
    expect(text).toBe("0.423-0.459 lb/ft");
    expect(text).not.toContain("2.300");
  });
  test("a band with a name keeps its name on every plant", () => {
    const named = { bandText: "Heavy", bandMinG: 2300, bandMaxG: 2500 };
    expect(copyBandCell(named, plant({ linear_mass: "lb_ft" }))).toBe("Heavy");
    expect(copyBandCell(named, plant({}))).toBe("Heavy");
  });
  test("an older answer without the ends keeps the server text with the plant's word", () => {
    expect(copyBandCell({ bandText: "2.300-2.500" }, plant({}))).toBe("2.300-2.500 kg/12ft");
  });
});
