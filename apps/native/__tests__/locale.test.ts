import { describe, expect, test } from "bun:test";

import { LOCALE_STORAGE_KEY, pickLocale } from "../lib/locale";

describe("pickLocale", () => {
  test("uses the same storage key as web, valid for SecureStore", () => {
    expect(LOCALE_STORAGE_KEY).toBe("orrn.locale");
    expect(LOCALE_STORAGE_KEY).toMatch(/^[\w.-]+$/);
  });

  test("a saved choice wins over the device language", () => {
    expect(pickLocale("hi", ["en"])).toBe("hi");
    expect(pickLocale("en", ["hi"])).toBe("en");
  });

  test("first run follows the device: Hindi phones open in Hindi", () => {
    expect(pickLocale(null, ["hi"])).toBe("hi");
    expect(pickLocale(null, ["gu", "hi", "en"])).toBe("hi");
    expect(pickLocale(null, ["en"])).toBe("en");
  });

  test("anything else falls back to English", () => {
    expect(pickLocale(null, ["gu", "mr"])).toBe("en");
    expect(pickLocale("fr", [])).toBe("en");
    expect(pickLocale(undefined, [null, undefined])).toBe("en");
  });
});
