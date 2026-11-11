/**
 * Parity with the registry in @orrn/domain (feat/units-core): the same typed text must give the same canonical number.
 * The registry names units with underscores (`kg_12ft`, `quintal`, `paise_kg`) and the recipe strings of plan B2 use
 * slashes (`kg/12ft`). The adapter maps one spelling to the other and calls the registry; this test proves the
 * mapping keeps every number the same.
 */
import { describe, expect, test } from "bun:test";
import { convertToCanonical as registryConvert, parseUnitToken as registryParse, unitsFor as registryUnitsFor } from "@orrn/domain";

import { UNIT_KINDS } from "./recipe";
import { convertToCanonical, parseUnitToken, splitFeetInches, unitsFor } from "./units-adapter";

const VALUES = ["0", "1", "0.5", "2.4", "2.09", "58.4", "1.0015", "2.0005", "12", "214.5", "3658", "44.55", "0.0005", "1234567.891", "9999.9999"];

/**
 * Units the adapter reads that the registry does not list (it answers unit_mismatch). Written down so a change shows.
 * Empty since the adapter delegates its maths to the registry: lb/12ft, g/ft, lb/m, paise/t, paise/qtl and a
 * dimension in cm were dropped until the units lane adds them to the registry.
 */
const ADAPTER_ONLY = new Set<string>();
const seenAdapterOnly = new Set<string>();

describe("adapter and registry agree on every number", () => {
  for (const kind of UNIT_KINDS) {
    for (const unit of unitsFor(kind)) {
      if (unit === "ft_in") continue;
      test(`${kind} ${unit}`, () => {
        for (const decimal of VALUES) {
          const mine = convertToCanonical({ kind, unit, decimal });
          // The registry takes the plan's slash spelling through its alias table.
          const theirs = registryConvert({ kind, unit, decimal });
          if (!theirs.ok && theirs.code === "unit_mismatch" && mine.ok) {
            seenAdapterOnly.add(`${kind} ${unit}`);
          } else if (mine.ok && theirs.ok) {
            expect({ unit, decimal, canonical: theirs.canonical, rounded: theirs.rounded }).toEqual({ unit, decimal, canonical: mine.canonical, rounded: mine.rounded });
          } else if (!theirs.ok && theirs.code === "out_of_range" && mine.ok) {
            // The registry also refuses values past a sanity cap (a unit slip). The adapter stops at the integer limit.
            expect(mine.canonical).toBeGreaterThan(1e6);
          } else {
            expect({ unit, decimal, ok: theirs.ok }).toEqual({ unit, decimal, ok: mine.ok });
          }
        }
      });
    }
  }

  test("feet and inches", () => {
    for (const text of [`12' 6"`, "11 ft 6 in", "12ft", "6 in", "12-6"]) {
      const split = splitFeetInches(text);
      const theirs = registryConvert({ kind: "length", unit: "ft_in", decimal: text });
      if (split !== null) {
        const mine = convertToCanonical({ kind: "length", unit: "ft_in", decimal: split });
        expect(mine.ok && theirs.ok && mine.canonical).toBe(theirs.ok ? theirs.canonical : -1);
      }
    }
  });

  test("tokens that mean a unit in the adapter mean the same unit in the registry (by value)", () => {
    for (const [kind, token] of [["mass", "Kgs"], ["mass", "qtl"], ["length", "Mtr"], ["linear_mass", "kg/12ft"], ["price_per_mass", "Rs/Kg"], ["price_per_mass", "INR/t"]] as const) {
      const mine = parseUnitToken(kind, token);
      const theirs = registryParse(kind, token);
      expect(mine === null).toBe(theirs === null);
      if (mine && theirs) {
        const a = convertToCanonical({ kind, unit: mine, decimal: "7.25" });
        const b = registryConvert({ kind, unit: theirs, decimal: "7.25" });
        expect(a.ok && b.ok && a.canonical).toBe(b.ok ? b.canonical : -1);
      }
    }
  });

  test("units only the adapter reads", () => {
    expect([...seenAdapterOnly].sort()).toEqual([...ADAPTER_ONLY].sort());
  });

  test("known differences, written down so a change shows", () => {
    // The registry has no `nos`; the adapter keeps it because office sheets write "Nos".
    expect(registryUnitsFor("count")).toEqual(["pcs"]);
    expect(unitsFor("count")).toEqual(["pcs", "nos"]);
  });
});
