import { describe, expect, test } from "bun:test";

import { canStartSwitch, switcherPlants } from "./plant-switcher-model";

const two = [
  { companyId: "b", name: "Plant B", role: "accountant" },
  { companyId: "a", name: "Plant A", role: "office" },
];

describe("FP-PF-17 plant switcher", () => {
  test("hidden with one plant or none", () => {
    expect(switcherPlants({ company: { id: "a", name: "Plant A" }, memberships: [two[1]!] })).toBeNull();
    expect(switcherPlants({ company: { id: "a", name: "Plant A" }, memberships: [] })).toBeNull();
    expect(switcherPlants(null)).toBeNull();
    expect(switcherPlants({ company: null, memberships: two })).toBeNull();
  });
  test("hidden during impersonation, even with many plants", () => {
    expect(switcherPlants({ company: { id: "a", name: "Plant A" }, memberships: two, impersonation: { grantId: "g" } })).toBeNull();
  });
  test("lists every plant with its own role, the current one first", () => {
    expect(switcherPlants({ company: { id: "a", name: "Plant A" }, memberships: two, impersonation: null })).toEqual([
      { companyId: "a", name: "Plant A", role: "office", current: true },
      { companyId: "b", name: "Plant B", role: "accountant", current: false },
    ]);
  });
});

describe("one plant switch at a time across the header and the palette (CodeRabbit)", () => {
  const plants = [
    { companyId: "a", name: "Plant A", role: "office", current: true },
    { companyId: "b", name: "Plant B", role: "office", current: false },
  ];
  test("starts when nothing is switching and the target is another known plant", () => {
    expect(canStartSwitch(plants, "b", 0)).toBe(true);
  });
  test("never while any switch is in flight, from either surface", () => {
    expect(canStartSwitch(plants, "b", 1)).toBe(false);
  });
  test("never to the current plant, an unknown plant, or with nothing to switch", () => {
    expect(canStartSwitch(plants, "a", 0)).toBe(false);
    expect(canStartSwitch(plants, "zz", 0)).toBe(false);
    expect(canStartSwitch(null, "b", 0)).toBe(false);
  });
});
