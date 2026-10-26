import { describe, expect, test } from "bun:test";

import { showsQueryError } from "./query-state";

describe("showsQueryError", () => {
  test("a first load that failed shows the error panel", () => {
    expect(showsQueryError({ isError: true, data: undefined })).toBe(true);
  });

  test("a failed refetch keeps the numbers already on screen (React Query v5 keeps data)", () => {
    expect(showsQueryError({ isError: true, data: { items: [] } })).toBe(false);
    expect(showsQueryError({ isError: true, data: null })).toBe(false);
    expect(showsQueryError({ isError: true, data: 0 })).toBe(false);
  });

  test("no error, no panel", () => {
    expect(showsQueryError({ isError: false, data: undefined })).toBe(false);
    expect(showsQueryError({ isError: false, data: { items: [] } })).toBe(false);
  });
});
