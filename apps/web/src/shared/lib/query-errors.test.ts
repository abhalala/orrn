import { describe, expect, test } from "bun:test";

import { hasInlineError, INLINE_ERROR_META } from "./query-errors";

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
