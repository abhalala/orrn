import { afterEach, describe, expect, test } from "bun:test";

import { clearExpectedPlant, expectedPlant, expectPlant, unitsBelongTo } from "./plant-sync";

afterEach(() => clearExpectedPlant());

describe("units belong to the plant the screens wait for", () => {
  test("nothing awaited: whatever is in hand is used, even nothing", () => {
    expect(unitsBelongTo(null, "plant-a")).toBe(true);
    expect(unitsBelongTo(null, undefined)).toBe(true);
  });
  test("a plant is awaited: only its own units pass", () => {
    expect(unitsBelongTo("plant-b", "plant-a")).toBe(false);
    expect(unitsBelongTo("plant-b", undefined)).toBe(false);
    expect(unitsBelongTo("plant-b", null)).toBe(false);
    expect(unitsBelongTo("plant-b", "plant-b")).toBe(true);
  });
  test("the expectation is set and cleared", () => {
    expectPlant("plant-b");
    expect(expectedPlant()).toBe("plant-b");
    clearExpectedPlant();
    expect(expectedPlant()).toBeNull();
  });
});
