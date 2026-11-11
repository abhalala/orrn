import { describe, expect, test } from "bun:test";

import { formatterFor, screenPrefs } from "@orrn/domain";

import { range12ftText } from "./bundle-facts";

const env = { locale: "en", timeZone: "Asia/Kolkata" } as const;
const fmtOf = (p: Parameters<typeof screenPrefs>[0] = {}) => formatterFor(screenPrefs(p), env);

describe("the bundle page weight range of 12 ft", () => {
  test("a plant on kg/12ft reads the bare number it always did", () => {
    expect(range12ftText(fmtOf(), 1.84)).toBe("1.8");
    expect(range12ftText(fmtOf(), null)).toBe("-");
  });
  test("a lb/ft or kg/m plant reads the packing list's figure with its unit word, under no unit of its own", () => {
    expect(range12ftText(fmtOf({ units: { linear_mass: "lb_ft" } }), 1.84)).toBe("1.8 kg/12ft");
    expect(range12ftText(fmtOf({ units: { linear_mass: "kg_m" } }), 1.84)).toBe("1.8 kg/12ft");
    expect(range12ftText(fmtOf({ units: { linear_mass: "lb_ft" } }), null)).toBe("-");
  });
});
