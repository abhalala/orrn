import { describe, expect, test } from "bun:test";

import { pickerId, pickerItems, pickerValue } from "./master-options";

const items = [
  { id: "a", name: "Bundle", active: true },
  { id: "b", name: "Old crate", active: false },
  { id: "c", name: "Box", active: true },
];

describe("master picker options", () => {
  test("offers active entries in list order", () => {
    expect(pickerItems(items, null).map((m) => m.id)).toEqual(["a", "c"]);
  });
  test("keeps a retired entry that is already chosen", () => {
    expect(pickerItems(items, "b").map((m) => m.id)).toEqual(["a", "b", "c"]);
  });
  test("no list yet gives no options", () => {
    expect(pickerItems(undefined, "a")).toEqual([]);
  });
  test("empty value clears, null shows empty", () => {
    expect(pickerId("")).toBeNull();
    expect(pickerId("a")).toBe("a");
    expect(pickerValue(null)).toBe("");
    expect(pickerValue(undefined)).toBe("");
    expect(pickerValue("a")).toBe("a");
  });
});
