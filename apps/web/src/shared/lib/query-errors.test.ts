import { describe, expect, test } from "bun:test";

import { hasInlineError, INLINE_ERROR_META, refreshFailed, showsQueryError } from "./query-errors";

describe("hasInlineError", () => {
  test("a query whose screen shows its own error state keeps the global toast quiet", () => {
    expect(hasInlineError({ meta: INLINE_ERROR_META })).toBe(true);
    expect(hasInlineError({ meta: { inlineError: true } })).toBe(true);
  });

  test("every other query still gets the toast", () => {
    expect(hasInlineError({})).toBe(false);
    expect(hasInlineError({ meta: undefined })).toBe(false);
    expect(hasInlineError({ meta: { inlineError: "yes" } })).toBe(false);
    expect(hasInlineError({ meta: { other: true } })).toBe(false);
  });
});

describe("showsQueryError / refreshFailed", () => {
  // React Query v5 keeps `data` and sets isError when a refetch fails.
  const firstLoadFailed = { isError: true, data: undefined };
  const refetchFailed = { isError: true, data: { packed: 1 } };
  const fine = { isError: false, data: { packed: 1 } };
  const loading = { isError: false, data: undefined };

  test("the error panel shows only when there is nothing to show", () => {
    expect(showsQueryError(firstLoadFailed)).toBe(true);
    expect(showsQueryError(refetchFailed)).toBe(false);
    expect(showsQueryError(fine)).toBe(false);
    expect(showsQueryError(loading)).toBe(false);
  });

  test("a failed background refresh keeps the last numbers and says so", () => {
    expect(refreshFailed(refetchFailed)).toBe(true);
    expect(refreshFailed(firstLoadFailed)).toBe(false);
    expect(refreshFailed(fine)).toBe(false);
    expect(refreshFailed(loading)).toBe(false);
  });

  test("falsy data such as 0 or an empty list still counts as data", () => {
    expect(showsQueryError({ isError: true, data: 0 })).toBe(false);
    expect(showsQueryError({ isError: true, data: [] })).toBe(false);
    expect(refreshFailed({ isError: true, data: [] })).toBe(true);
  });
});
