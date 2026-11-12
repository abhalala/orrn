import { describe, expect, test } from "bun:test";

import { formatterFor, screenPrefs } from "@orrn/domain";
import { createI18n } from "@orrn/i18n";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { en } from "@orrn/i18n/en";

import { PLANT_SECTION_TEXT, readingEmptyBody, readingWeightLabel } from "./reading-text";

const IST = { locale: "en", timeZone: "Asia/Kolkata" } as const;
const fmtOf = (p: Parameters<typeof screenPrefs>[0] = {}) => formatterFor(screenPrefs(p), IST);

describe("the reading pad asks for the plant's section unit", () => {
  const { t } = createI18n("en");
  test("a plant on kg per 12 ft keeps the paper's words", () => {
    expect(readingWeightLabel(t, fmtOf())).toBe("Weight of 12 ft");
    expect(readingEmptyBody(t, fmtOf())).toBe("Weigh 12 ft off this die and add the weight.");
  });
  for (const [name, units, word] of [["kg per metre", { linear_mass: "kg_m" }, "kg/m"], ["lb per foot", { linear_mass: "lb_ft" }, "lb/ft"]] as const) {
    test(`${name}: the label and the empty text name ${word} and never 12 ft`, () => {
      const f = fmtOf({ units });
      expect(readingWeightLabel(t, f)).toBe(`Section weight (${word})`);
      expect(readingWeightLabel(t, f)).not.toContain("12 ft");
      expect(readingEmptyBody(t, f)).toBe(`Weigh a piece of this die and add its weight in ${word}.`);
      expect(readingEmptyBody(t, f)).not.toContain("12 ft");
    });
  }
  test("hindi has both plant sentences", () => {
    const hi = createI18n("hi").t;
    const f = fmtOf({ units: { linear_mass: "lb_ft" } });
    expect(readingWeightLabel(hi, f)).toContain("lb/ft");
    expect(readingEmptyBody(hi, f)).toContain("lb/ft");
  });
});

describe("the section reading box and its keypad", () => {
  test("the keypad builds at most three places, the places a section weight is stored to", () => {
    expect(PLANT_SECTION_TEXT.test("0.423")).toBe(true);
    expect(PLANT_SECTION_TEXT.test("0.4235")).toBe(false);
    expect(PLANT_SECTION_TEXT.test("12345")).toBe(false);
  });
  test("a refused press reading says the section unit, not the weight unit", () => {
    const src = readFileSync(join(import.meta.dir, "../press/station-count.tsx"), "utf8");
    expect(src).toContain('(typedReading === null || typedReading <= 0)) return invalid("dieRoom.band.kgInvalid")');
    expect(src).not.toMatch(/typedReading <= 0\)\) return invalid\("press\.console\.kgInvalid"\)/);
    expect(en.dieRoom.band.kgInvalid).toContain("{sectionUnit}");
  });
});
