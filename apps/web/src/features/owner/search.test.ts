import { describe, expect, test } from "bun:test";

import { parseOwnerSearch } from "./search";

describe("parseOwnerSearch", () => {
  test("keeps a real day", () => expect(parseOwnerSearch({ day: "2026-11-21" })).toEqual({ day: "2026-11-21" }));
  test("drops a missing, odd or impossible day", () => {
    expect(parseOwnerSearch({})).toEqual({});
    expect(parseOwnerSearch({ day: "yesterday" })).toEqual({});
    expect(parseOwnerSearch({ day: "2026-02-30" })).toEqual({});
    expect(parseOwnerSearch({ day: 20261121 })).toEqual({});
  });
});
