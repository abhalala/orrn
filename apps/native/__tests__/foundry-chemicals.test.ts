import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { can, type Me } from "@orrn/server/lib/permissions";

import { blankForm, saveInputOf } from "../features/foundry/melt-form";

const read = (path: string) => readFileSync(join(import.meta.dir, "..", path), "utf8");
const editor = read("features/foundry/melt-editor.tsx");
const sections = read("features/foundry/melt-sections.tsx");

function me(role: NonNullable<Me["company"]>["role"]): Me {
  return {
    user: { id: "u", name: "A", email: "a@b.in" },
    company: { id: "c", name: "P", slug: "p", status: "active", plan: null, role, modules: ["foundry"] },
    isPlatformAdmin: false,
  };
}

describe("chemical and LDO editing", () => {
  test("the draft editor remains behind melt.enter and loads the same store list as the web", () => {
    expect(can(me("foundry"), "melt.enter")).toBe(true);
    expect(can(me("supervisor"), "melt.enter")).toBe(true);
    expect(can(me("packer"), "melt.enter")).toBe(false);
    expect(read("features/foundry/melt-view.tsx")).toContain('can(me, "melt.enter")');
    expect(editor).toContain("trpc.store.items.list.queryOptions()");
    expect(editor).toContain("<ChemicalsSection {...common} storeItems={(store.data?.items ?? []) as StoreItem[]} />");
  });

  test("the UI has store and typed chemicals, computed close, remove, the line cap and all five dips", () => {
    for (const text of ["item.active", "taken.has(x.id)", '"__other"', "CHEMICAL_UNITS.map", "open - used", "<RemoveButton", "MAX_CHEMICALS", "LDO_KEYS.map"]) expect(sections).toContain(text);
    expect(sections).toContain("foundry.melt.issue.chemicalClose");
    expect(sections).toContain("foundry.melt.issue.ldo");
    expect(editor).toContain('type Part = "times" | "charge" | "chemicals" | "output" | "spectro"');
    expect(editor).toContain("const partOf = (step: Step): Part => step");
  });

  test("the existing save step sends chemical quantities and LDO tenths", () => {
    const form = blankForm("2026-11-11");
    form.chemicals = [{ key: "c", storeItemId: "", name: "Cover flux", unit: "kg", openText: "5", usedText: "2", closeText: "" }];
    form.ldo = { start: "42.5", chargingStart: "41", chargingEnd: "", castingStart: "", end: "37" };
    const result = saveInputOf(form, { castId: "cast-1", timeZone: "Asia/Kolkata" });
    if (!result.ok) throw new Error("valid chemicals and dips should save");
    expect(result.input.chemicals).toEqual([{ name: "Cover flux", unit: "kg", openMilli: 5000, usedMilli: 2000, closeMilli: 3000 }]);
    expect(result.input.ldoTenthIn).toEqual({ start: 425, chargingStart: 410, chargingEnd: null, castingStart: null, end: 370 });
  });

  test("the web's validation refuses a bad close and an LDO dip above 240 inches", () => {
    const form = blankForm("2026-11-11");
    form.chemicals = [{ key: "c", storeItemId: "flux", name: "", unit: "", openText: "5", usedText: "2", closeText: "2" }];
    expect(saveInputOf(form, { castId: "cast-1", timeZone: "Asia/Kolkata" })).toEqual({ ok: false, issue: { code: "chemicalClose", step: "chemicals", line: 0 } });
    form.chemicals = [];
    form.ldo.start = "241";
    expect(saveInputOf(form, { castId: "cast-1", timeZone: "Asia/Kolkata" })).toEqual({ ok: false, issue: { code: "ldo", step: "chemicals" } });
  });

  test("store read failures and save refusals stay visible", () => {
    expect(editor).toContain("store.isError && !store.data");
    expect(editor).toContain("<ErrorBlock error={store.error}");
    expect(editor).toContain("<ErrorLine error={problem} />");
    expect(editor).toContain("announce(foundryError(t, error))");
  });
});
