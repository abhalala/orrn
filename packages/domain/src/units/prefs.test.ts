import { describe, expect, test } from "bun:test";

import {
  documentPrefs, LEGACY_DOC_UNITS, ORRN_DEFAULT_PREFS, prefsKey, readUnitSettings, readUserPrefs, screenPrefs,
  validatePlantUnitSettings, validateUnitPrefs,
} from "./prefs";
import { KINDS } from "./registry";

describe("defaults", () => {
  test("the orrn default is today's screens", () => {
    expect(ORRN_DEFAULT_PREFS.units).toMatchObject({ mass: "kg", length: "mm", linear_mass: "kg_12ft", money: "inr", ratio: "pct" });
    expect(ORRN_DEFAULT_PREFS.number).toEqual({ grouping: "indian", decimal: ".", group: "," });
    expect(ORRN_DEFAULT_PREFS.date).toEqual({ order: "dmy", month: "short" });
    expect(ORRN_DEFAULT_PREFS.clock).toBe("h23");
    expect(Object.keys(ORRN_DEFAULT_PREFS.units).sort()).toEqual([...KINDS].sort());
  });
  test("the legacy document set is feet and inches with kg at 2 places", () => {
    expect(LEGACY_DOC_UNITS.units.length).toBe("ft_in");
    expect(LEGACY_DOC_UNITS.inchGrid).toBe(4);
    expect(LEGACY_DOC_UNITS.precision["mass.print"]).toBe(2);
  });
  test("an empty chain gives the default, and a resolve never mutates the default", () => {
    const before = prefsKey(ORRN_DEFAULT_PREFS);
    const p = screenPrefs({}, {});
    expect(prefsKey(p)).toBe(before);
    p.units.mass = "t";
    p.number.grouping = "none";
    expect(prefsKey(ORRN_DEFAULT_PREFS)).toBe(before);
  });
});

describe("screens: default, then plant, then user", () => {
  test("a later layer wins per key", () => {
    const p = screenPrefs({ units: { mass: "t", length: "ft_in" }, clock: "h12" }, { units: { mass: "lb" }, date: { order: "mdy" } });
    expect(p.units.mass).toBe("lb");
    expect(p.units.length).toBe("ft_in");
    expect(p.clock).toBe("h12");
    expect(p.date.order).toBe("mdy");
    expect(p.date.month).toBe("short");
    expect(p.units.linear_mass).toBe("kg_12ft");
  });
  test("a locked kind ignores the user, units and precision both", () => {
    const plant = { units: { mass: "kg" as const }, lock: ["mass" as const] };
    const p = screenPrefs(plant, { units: { mass: "lb", length: "m" }, precision: { "mass.screen": 5, "length.screen": 2 } });
    expect(p.units.mass).toBe("kg");
    expect(p.units.length).toBe("m");
    expect(p.precision["mass.screen"]).toBeUndefined();
    expect(p.precision["length.screen"]).toBe(2);
  });
  test("number style merges by field", () => {
    const p = screenPrefs({ number: { grouping: "international" } }, { number: { decimal: "," , group: "." } });
    expect(p.number).toEqual({ grouping: "international", decimal: ",", group: "." });
  });
  test("one mark alone never resolves to a set whose decimal and group marks are the same", () => {
    // decimal "," alone over the default group ","
    expect(screenPrefs({ number: { decimal: "," } }).number).toEqual({ grouping: "indian", decimal: ",", group: "." });
    // group "." alone over the default decimal "." keeps the group mark the plant had
    expect(screenPrefs({ number: { group: "." } }).number).toEqual({ grouping: "indian", decimal: ".", group: "," });
    // a user layer that sends one mark over a plant with different marks
    const plant = { number: { decimal: "," as const, group: "." as const } };
    expect(screenPrefs(plant, { number: { decimal: "." } }).number).toEqual({ grouping: "indian", decimal: ".", group: "," });
    expect(screenPrefs(plant, { number: { group: "," } }).number).toEqual({ grouping: "indian", decimal: ",", group: "." });
    // a stored clash from before reads safely too
    const stored = readUnitSettings({ units: { number: { decimal: "," } } });
    const p = screenPrefs(stored);
    expect(p.number.decimal).not.toBe(p.number.group);
    // a plant that changed nothing is untouched
    expect(screenPrefs({}).number).toEqual({ grouping: "indian", decimal: ".", group: "," });
  });
  test("a plant write that sends one mark alone is refused when it lands on the default's other mark", () => {
    for (const number of [{ decimal: "," }, { group: "." }]) {
      const r = validatePlantUnitSettings({ number });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.join(" ")).toContain("must differ");
    }
    expect(validatePlantUnitSettings({ number: { decimal: ",", group: "." } }).ok).toBe(true);
    expect(validatePlantUnitSettings({ number: { grouping: "international" } }).ok).toBe(true);
  });
  test("a plant's legacy lengthUnit reads as a unit choice", () => {
    expect(readUnitSettings({ lengthUnit: "inch" })).toMatchObject({ units: { length: "ft_in" }, inchGrid: 4 });
    expect(readUnitSettings({ lengthUnit: "mm" }).units).toEqual({ length: "mm" });
    expect(readUnitSettings({ lengthUnit: "inch", units: { units: { length: "m" } } }).units).toEqual({ length: "m" });
    expect(screenPrefs(readUnitSettings({ lengthUnit: "inch" })).units.length).toBe("ft_in");
  });
});

describe("documents: default, plant, document type, customer", () => {
  const plant = {
    units: { mass: "kg" as const },
    documents: {
      packing_list: { units: { length: "ft_in" as const, linear_mass: "kg_12ft" as const }, fixed: ["linear_mass" as const] },
      label: { units: { mass: "kg" as const } },
    },
  };
  test("the customer is the most specific audience", () => {
    const p = documentPrefs(plant, "packing_list", { units: { mass: "lb", length: "mm" } });
    expect(p.units.mass).toBe("lb");
    expect(p.units.length).toBe("mm");
  });
  test("a fixed kind holds against the customer", () => {
    const p = documentPrefs(plant, "packing_list", { units: { linear_mass: "kg_m" }, precision: { "linear_mass.print": 5 } });
    expect(p.units.linear_mass).toBe("kg_12ft");
    expect(p.precision["linear_mass.print"]).toBeUndefined();
  });
  test("the document type layer applies to that type only", () => {
    expect(documentPrefs(plant, "packing_list").units.length).toBe("ft_in");
    expect(documentPrefs(plant, "label").units.length).toBe("mm");
    expect(documentPrefs(plant, "certificate").units.length).toBe("mm");
  });
  test("the user's own preference never reaches a document", () => {
    expect(documentPrefs(plant, "label", null).units.mass).toBe("kg");
  });
  test("null and missing customer are the same", () => {
    expect(prefsKey(documentPrefs(plant, "label", null))).toBe(prefsKey(documentPrefs(plant, "label")));
  });
});

describe("tolerant readers", () => {
  test("junk gives defaults and never throws", () => {
    for (const junk of [null, undefined, 5, "x", [], {}, { units: 5 }, { units: { mass: 5, nope: "kg" } }, { number: "x" }, { precision: { a: 1 } }]) {
      expect(() => readUserPrefs(junk)).not.toThrow();
      expect(() => readUnitSettings(junk)).not.toThrow();
      expect(prefsKey(screenPrefs(readUnitSettings(junk), readUserPrefs(junk)))).toBe(prefsKey(ORRN_DEFAULT_PREFS));
    }
  });
  test("unknown ids and wrong kinds are dropped, the rest kept", () => {
    const p = readUserPrefs({ units: { mass: "lb", length: "kg", pressure: "bogus", nope: "kg", temperature: "deci_c" }, clock: "h12", inchGrid: 7 });
    expect(p).toEqual({ v: 1, units: { mass: "lb" }, clock: "h12" });
  });
  test("settings: lock and documents survive, junk inside them does not", () => {
    const s = readUnitSettings({
      units: { lock: ["mass", "bogus"], documents: { label: { units: { mass: "lb" }, fixed: ["length", "x"] }, nope: {} } },
    });
    expect(s.lock).toEqual(["mass"]);
    expect(s.documents?.label?.units).toEqual({ mass: "lb" });
    expect(s.documents?.label?.fixed).toEqual(["length"]);
    expect(s.documents && "nope" in s.documents).toBe(false);
  });
});

describe("validateUnitPrefs refuses on write", () => {
  test("good prefs pass and come back clean", () => {
    const r = validateUnitPrefs({ v: 1, units: { mass: "lb", length: "ft_in" }, inchGrid: 8, number: { grouping: "none" }, clock: "h12" });
    expect(r.ok && r.prefs.units).toEqual({ mass: "lb", length: "ft_in" });
  });
  test("unknown unit, wrong kind, storage-only unit, bad values", () => {
    const bad = (x: unknown) => {
      const r = validateUnitPrefs(x);
      return r.ok ? [] : r.errors;
    };
    expect(bad({ units: { mass: "furlong" } })[0]).toContain("unknown unit");
    expect(bad({ units: { mass: "mm" } })[0]).toContain("not a unit of mass");
    expect(bad({ units: { length: "um" } })[0]).toContain("not offered");
    expect(bad({ units: { gold: "kg" } })[0]).toContain("unknown kind");
    expect(bad({ inchGrid: 5 })[0]).toContain("inchGrid");
    expect(bad({ clock: "h13" })[0]).toContain("clock");
    expect(bad({ number: { decimal: ",", group: "," } })[0]).toContain("differ");
    expect(bad({ precision: { "mass.screen": 99 } })[0]).toContain("precision");
    expect(bad({ precision: { "gold.screen": 1 } })[0]).toContain("precision");
    expect(bad("x")[0]).toContain("object");
  });
  test("a bad date, currency or a non-object block is refused, not dropped (slice b)", () => {
    const bad = (x: unknown) => {
      const r = validateUnitPrefs(x);
      return r.ok ? [] : r.errors;
    };
    expect(bad({ date: { order: "ydm" } })[0]).toContain("date.order");
    expect(bad({ date: { month: "long" } })[0]).toContain("date.month");
    expect(bad({ date: "dmy" })[0]).toContain("date must be an object");
    expect(bad({ currency: { symbol: "$" } })[0]).toContain("currency.symbol");
    expect(bad({ currency: { compact: "western" } })[0]).toContain("currency.compact");
    expect(bad({ number: "indian" })[0]).toContain("number must be an object");
    // The tolerant reader still drops them without a word.
    expect(readUserPrefs({ date: { order: "ydm" }, number: "indian" })).toEqual({});
  });
  test("over 2 kB is refused", () => {
    const big = { units: { mass: "kg" }, pad: "x".repeat(3000) };
    const r = validateUnitPrefs(big);
    expect(!r.ok && r.errors[0]).toContain("2048");
  });
  test("plant settings: lock must name kinds, documents must name types", () => {
    expect(validatePlantUnitSettings({ lock: ["mass"], documents: { label: { units: { mass: "kg" } } } }).ok).toBe(true);
    expect(validatePlantUnitSettings({ lock: ["gold"] }).ok).toBe(false);
    expect(validatePlantUnitSettings({ documents: { invoice: {} } }).ok).toBe(false);
  });
});

describe("prefsKey", () => {
  test("equal sets give equal keys, however the keys were ordered", () => {
    const a = screenPrefs({ units: { mass: "lb", length: "m" } });
    const b = screenPrefs({ units: { length: "m", mass: "lb" } });
    expect(prefsKey(a)).toBe(prefsKey(b));
    expect(prefsKey(a)).not.toBe(prefsKey(ORRN_DEFAULT_PREFS));
  });
});
