import { describe, expect, test } from "bun:test";

import { dayMonth, intlTag, ymdLabel } from "./intl-tag";

const D = new Date("2026-10-23T06:00:00Z");

describe("intlTag", () => {
  test("one tag per screen language, English for anything else", () => {
    expect(intlTag("en")).toBe("en-IN");
    expect(intlTag("hi")).toBe("hi-IN");
    expect(intlTag("gu")).toBe("gu-IN");
    expect(intlTag(undefined)).toBe("en-IN");
  });
});

describe("dayMonth (BACKLOG 87: dates follow the language)", () => {
  test("English reads 23 Oct", () => {
    expect(dayMonth(D, "en", "Asia/Kolkata")).toBe("23 Oct");
  });
  test("Gujarati has no English month and keeps Latin digits", () => {
    const s = dayMonth(D, "gu", "Asia/Kolkata");
    expect(s).toMatch(/^23 \S+$/);
    expect(s).not.toContain("Oct");
    expect(s).toMatch(/[઀-૿]/);
  });
  test("Hindi has no English month and keeps Latin digits", () => {
    const s = dayMonth(D, "hi", "Asia/Kolkata");
    expect(s).toMatch(/^23 \S+$/);
    expect(s).not.toContain("Oct");
    expect(s).toMatch(/[ऀ-ॿ]/);
  });
  test("year when asked, and an unknown zone does not throw", () => {
    expect(dayMonth(D, "en", "Asia/Kolkata", true)).toBe("23 Oct 2026");
    expect(() => dayMonth(D, "gu", "Mars/Olympus")).not.toThrow();
  });
});

describe("ymdLabel", () => {
  test("a production day reads in the language, not as ISO (walk-through L8)", () => {
    expect(ymdLabel("2026-10-25", "en")).toBe("25 Oct 2026");
    expect(ymdLabel("2026-10-25", "gu")).toMatch(/^25 [\u0A80-\u0AFF]+ 2026$/);
    expect(ymdLabel("2026-10-25", "hi")).toMatch(/^25 [\u0900-\u097F]+ 2026$/);
  });
  test("anything else is returned as it came", () => {
    expect(ymdLabel("tomorrow", "en")).toBe("tomorrow");
  });
});
