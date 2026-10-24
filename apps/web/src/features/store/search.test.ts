import { describe, expect, test } from "bun:test";

import { storeEntrySearch } from "./search";

describe("storeEntrySearch (?item= on Receive, Issue, Exchange)", () => {
  test("keeps a plausible item id", () => {
    expect(storeEntrySearch({ item: "6f1c2a9e-1b2c-4d5e-8f90-123456789abc" })).toEqual({
      item: "6f1c2a9e-1b2c-4d5e-8f90-123456789abc",
    });
  });

  test("drops anything else", () => {
    expect(storeEntrySearch({})).toEqual({});
    expect(storeEntrySearch({ item: "" })).toEqual({});
    expect(storeEntrySearch({ item: 42 })).toEqual({});
    expect(storeEntrySearch({ item: "x".repeat(65) })).toEqual({});
  });
});
