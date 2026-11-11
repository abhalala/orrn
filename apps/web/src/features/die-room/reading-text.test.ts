import { describe, expect, test } from "bun:test";

import { formatterFor, screenPrefs } from "@orrn/domain";
import { createI18n } from "@orrn/i18n";

import { readingEmptyBody, readingWeightLabel } from "./reading-text";

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
