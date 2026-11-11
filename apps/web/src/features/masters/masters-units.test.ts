/**
 * Masters screens write weights through the plant formatter (units layer, review fix): the die copies "Latest" column under
 * "Latest {sectionUnit}" and the locations "holds" figure beside {massUnit}.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { formatterFor, screenPrefs } from "@orrn/domain";

import { kgGrouped1, sectionText } from "@/shared/lib/fmt-text";

const lb = formatterFor(screenPrefs({ units: { mass: "lb", linear_mass: "lb_ft" } }), { locale: "en", timeZone: "Asia/Kolkata" });
const read = (f: string) => readFileSync(join(import.meta.dir, f), "utf8");

describe("masters figures", () => {
  test("a latest reading of 2.400 kg per 12 ft reads 0.441 on an lb/ft plant", () => {
    expect(sectionText(lb, 2400)).toBe("0.441");
  });
  test("a location holding 5,000 kg reads 11,023.1 on a pound plant", () => {
    expect(kgGrouped1(lb, 5_000_000)).toBe("11,023.1");
  });
  test("the pages call those helpers and not the kg ones", () => {
    const copies = read("die-copies-page.tsx");
    expect(copies).not.toContain("kgPer12ftInput(r.latest");
    expect(copies).toContain("sectionText(fmt, r.latestKgPer12ftMilli)");
    const places = read("locations-page.tsx");
    expect(places).not.toContain("formatKgTotal");
    expect(places).toContain("kgGrouped1(fmt, h.kgG)");
    // the scrap streams balance followed the plant's number but wrote a literal kg beside it
    const scrap = read("scrap-page.tsx");
    expect(scrap).not.toContain("formatKgTotal");
    expect(scrap).toContain("{kgGrouped1(fmt, r.balanceG)} {massUnit(fmt)}");
  });
});
