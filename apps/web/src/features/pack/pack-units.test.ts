/**
 * Pack session detail and review: the section weight column and the total carry the plant's unit (units layer, review fix).
 * A plant on lb/ft and lb must not read a kg/12ft figure under an lb/ft header, nor a kg total under lb.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { formatterFor, screenPrefs } from "@orrn/domain";

import { kgGrouped1, sectionOrNull } from "@/shared/lib/fmt-text";

const at = { locale: "en", timeZone: "Asia/Kolkata" } as const;
const lbFt = formatterFor(screenPrefs({ units: { linear_mass: "lb_ft", mass: "lb" } }), at);
const plain = formatterFor(screenPrefs({}), at);
const read = (rel: string) => readFileSync(join(import.meta.dir, rel), "utf8");

describe("figures the pack screens write", () => {
  test("a die at 2.400 kg per 12 ft reads 0.441 lb/ft; a plain plant reads 2.400", () => {
    expect(sectionOrNull(lbFt, 2400)).toBe("0.441");
    expect(sectionOrNull(plain, 2400)).toBe("2.400");
    expect(sectionOrNull(plain, null)).toBeNull();
  });
  test("a 1,250 kg session reads 2,755.8 lb on a pound plant and 1,250.0 kg on a plain plant", () => {
    expect(kgGrouped1(lbFt, 1_250_000)).toBe("2,755.8");
    expect(kgGrouped1(plain, 1_250_000)).toBe("1,250.0");
  });
});

describe("the screens use those helpers (the kg helpers are gone)", () => {
  test("pack.$id.tsx writes the section column through the plant formatter", () => {
    const src = read("../../routes/_tenant/pack.$id.tsx");
    expect(src).not.toContain("kg12Text(");
    expect(src).toContain("sectionOrNull(fmt, b.kgPer12ftMilli)");
  });
  test("review-step.tsx writes the total through the plant formatter", () => {
    const src = read("./review-step.tsx");
    expect(src).not.toContain("formatKgTotal");
    expect(src).toContain("kgGrouped1(fmt, Math.round(g))");
  });
});
