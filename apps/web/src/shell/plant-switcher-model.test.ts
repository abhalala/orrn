import { describe, expect, test } from "bun:test";

import { switcherPlants } from "./plant-switcher-model";

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
