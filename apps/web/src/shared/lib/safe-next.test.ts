import { describe, expect, test } from "bun:test";

import { safeNext } from "./safe-next";

describe("safeNext", () => {
  test("keeps same-origin paths with query and hash", () => {
    expect(safeNext("/dispatch/1?x=2", "/today")).toBe("/dispatch/1?x=2");
    expect(safeNext("/stock#top", "/today")).toBe("/stock#top");
    expect(safeNext("/today", "/admin")).toBe("/today");
  });

  test("rejects protocol-relative and backslash tricks", () => {
    expect(safeNext("//evil.com", "/today")).toBe("/today");
    expect(safeNext("//evil.com/path", "/today")).toBe("/today");
    expect(safeNext("/\\evil", "/today")).toBe("/today");
    expect(safeNext("/\\/evil.com", "/today")).toBe("/today");
  });

  test("rejects absolute and scheme URLs", () => {
    expect(safeNext("https://evil.com", "/today")).toBe("/today");
    expect(safeNext("http://evil.com/x", "/today")).toBe("/today");
    expect(safeNext("javascript:alert(1)", "/today")).toBe("/today");
    expect(safeNext("evil.com", "/today")).toBe("/today");
  });

  test("rejects control characters browsers strip from URLs", () => {
    expect(safeNext("/\t/evil.com", "/today")).toBe("/today");
    expect(safeNext("/\n/evil.com", "/today")).toBe("/today");
  });

  test("falls back for empty values and for the login page itself", () => {
    expect(safeNext(undefined, "/today")).toBe("/today");
    expect(safeNext(null, "/today")).toBe("/today");
    expect(safeNext("", "/today")).toBe("/today");
    expect(safeNext("/login?next=/x", "/today")).toBe("/today");
  });
});
