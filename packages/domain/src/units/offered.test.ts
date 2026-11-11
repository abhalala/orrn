import { describe, expect, test } from "bun:test";

import { offeredUnitProblems, OFFERED_KINDS, PLANT_UNIT_CHOICES } from "./offered";
import { ORRN_DEFAULT_PREFS } from "./prefs";
import { UNITS } from "./registry";

describe("what a plant may choose in the first release", () => {
  test("the list is the owner's: kg, tonne, lb; ft-in, mm, m; kg/12ft, kg/m, lb/ft", () => {
    expect(PLANT_UNIT_CHOICES).toEqual({
      mass: ["kg", "t", "lb"],
      length: ["mm", "ft_in", "m"],
      linear_mass: ["kg_12ft", "kg_m", "lb_ft"],
    });
    expect(OFFERED_KINDS).toEqual(["mass", "length", "linear_mass"]);
  });
  test("every offered unit exists, has the kind it is listed under, and the default of each kind is offered", () => {
    for (const k of OFFERED_KINDS) {
      for (const u of PLANT_UNIT_CHOICES[k]) expect(UNITS[u].kind).toBe(k);
      expect((PLANT_UNIT_CHOICES[k] as readonly string[]).includes(ORRN_DEFAULT_PREFS.units[k])).toBe(true);
    }
  });
  test("nothing outside the list passes; the default of a non-offered kind does", () => {
    expect(offeredUnitProblems({ units: { mass: "lb", length: "ft_in", linear_mass: "kg_m" } })).toEqual([]);
    expect(offeredUnitProblems({ units: { mass: "quintal" } })).toHaveLength(1);
    expect(offeredUnitProblems({ units: { temperature: "f" } })).toHaveLength(1);
    expect(offeredUnitProblems({ units: { temperature: "c" } })).toEqual([]);
    expect(offeredUnitProblems({ lock: ["mass"] })).toHaveLength(1);
    expect(offeredUnitProblems({ documents: { label: {} } })).toHaveLength(1);
    expect(offeredUnitProblems({ number: { grouping: "none" }, clock: "h12", date: { order: "ymd" } })).toEqual([]);
  });
});
