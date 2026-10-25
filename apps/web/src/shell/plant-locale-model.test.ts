import { describe, expect, test } from "bun:test";

import { plantLocaleFor } from "./plant-locale-model";

describe("plantLocaleFor (the plant's default language, PF §9-14)", () => {
  test("a device that chose keeps its choice", () => {
    expect(plantLocaleFor("en", { locale: "gu" })).toBeNull();
    expect(plantLocaleFor("hi", { locale: "gu" })).toBeNull();
  });

  test("a device that never chose follows a plant that chose, and stays English otherwise", () => {
    expect(plantLocaleFor(null, { locale: "gu" })).toBe("gu");
    expect(plantLocaleFor(null, { locale: "hi" })).toBe("hi");
    expect(plantLocaleFor(null, { locale: "en" })).toBeNull();
    expect(plantLocaleFor(null, {})).toBeNull();
    expect(plantLocaleFor(null, undefined)).toBeNull();
  });

  test("with the switch off (it ships off) a Gujarat plant that never chose stays English", () => {
    expect(plantLocaleFor(null, { letterhead: { gstin: "24ABCDE1234F1Z5" } })).toBeNull();
  });
});
