import { describe, expect, test } from "bun:test";

import {
  PAGE_SIZE,
  offsetOf,
  pageWithinTotal,
  sectionDefaultStatus,
  validateBundlesSearch,
  validateSectionSearch,
} from "./bundle-search";

describe("validateBundlesSearch (/stock/bundles)", () => {
  test("keeps a known status, drops unknown ones and the 'all' default", () => {
    expect(validateBundlesSearch({ status: "void" })).toEqual({ status: "void" });
    expect(validateBundlesSearch({ status: "all" })).toEqual({});
    expect(validateBundlesSearch({ status: "lost" })).toEqual({});
    expect(validateBundlesSearch({ status: 3 })).toEqual({});
  });

  test("search text is trimmed, capped and dropped when blank", () => {
    expect(validateBundlesSearch({ q: "  26I40  " })).toEqual({ q: "26I40" });
    expect(validateBundlesSearch({ q: "   " })).toEqual({});
    expect(validateBundlesSearch({ q: "x".repeat(300) }).q).toHaveLength(100);
  });

  test("a number search value from the URL still searches", () => {
    // TanStack parses ?q=4086 as the number 4086.
    expect(validateBundlesSearch({ q: 4086 })).toEqual({ q: "4086" });
  });

  test("page is a whole number from 2 up; page 1 and junk are omitted", () => {
    expect(validateBundlesSearch({ page: 3 })).toEqual({ page: 3 });
    expect(validateBundlesSearch({ page: "2" })).toEqual({ page: 2 });
    expect(validateBundlesSearch({ page: 1 })).toEqual({});
    expect(validateBundlesSearch({ page: 0 })).toEqual({});
    expect(validateBundlesSearch({ page: 2.5 })).toEqual({});
    expect(validateBundlesSearch({ page: "x" })).toEqual({});
  });

  test("old /bundles links keep their die and packing session filters", () => {
    expect(validateBundlesSearch({ dieId: "dev-die-14701", groupId: "dev-group-001" })).toEqual({
      dieId: "dev-die-14701",
      groupId: "dev-group-001",
    });
    expect(validateBundlesSearch({ dieId: "", groupId: 5 })).toEqual({});
  });
});

describe("validateSectionSearch (/stock/$dieId)", () => {
  test("keeps a chosen status (the default depends on the section's stock), drops unknown ones", () => {
    expect(validateSectionSearch({})).toEqual({});
    expect(validateSectionSearch({ status: "available" })).toEqual({ status: "available" });
    expect(validateSectionSearch({ status: "all" })).toEqual({ status: "all" });
    expect(validateSectionSearch({ status: "reserved", page: 2 })).toEqual({ status: "reserved", page: 2 });
    expect(validateSectionSearch({ status: "gone" })).toEqual({});
  });
});

describe("sectionDefaultStatus (no chip in the URL)", () => {
  test("in stock first; held when every bundle is held; all when nothing is on the floor", () => {
    expect(sectionDefaultStatus("inStock")).toBe("available");
    expect(sectionDefaultStatus("held")).toBe("reserved");
    expect(sectionDefaultStatus("none")).toBe("all");
  });
});

describe("offsetOf", () => {
  test("page to server offset, 50 a page", () => {
    expect(PAGE_SIZE).toBe(50);
    expect(offsetOf(undefined)).toBe(0);
    expect(offsetOf(2)).toBe(50);
    expect(offsetOf(4)).toBe(150);
  });
});

describe("pageWithinTotal (a page past the end)", () => {
  test("a page that has rows stays", () => {
    expect(pageWithinTotal(undefined, 120)).toBeUndefined();
    expect(pageWithinTotal(2, 120)).toBe(2);
    expect(pageWithinTotal(3, 120)).toBe(3);
  });

  test("a page past the end goes to the last page that has rows", () => {
    expect(pageWithinTotal(9, 120)).toBe(3);
    expect(pageWithinTotal(4, 150)).toBe(3);
    expect(pageWithinTotal(3, 100)).toBe(2);
  });

  test("when everything fits on one page, page 1 (left out of the URL)", () => {
    expect(pageWithinTotal(2, 50)).toBeUndefined();
    expect(pageWithinTotal(2, 1)).toBeUndefined();
    expect(pageWithinTotal(5, 0)).toBeUndefined();
  });
});
