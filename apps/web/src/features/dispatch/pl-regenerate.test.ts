import { describe, expect, test } from "bun:test";

import { regenerateState } from "./pl-regenerate";

describe("regenerateState (m-5)", () => {
  const revs = { currentId: "r3", revisions: [{ revision: 1 }, { revision: 2 }, { revision: 3 }] };

  test("the current revision can be regenerated as the next number", () => {
    expect(regenerateState({ id: "r3", revision: 3, combinedIntoId: null }, revs)).toEqual({ enabled: true, next: 4 });
  });

  test("an older revision opened by id cannot, and the number still follows the newest", () => {
    expect(regenerateState({ id: "r1", revision: 1, combinedIntoId: null }, revs)).toEqual({ enabled: false, next: 4 });
  });

  test("a list folded into a combined one cannot; nor while the revisions are loading", () => {
    expect(regenerateState({ id: "r3", revision: 3, combinedIntoId: "c1" }, revs).enabled).toBe(false);
    expect(regenerateState({ id: "r3", revision: 3, combinedIntoId: null }, undefined)).toEqual({ enabled: false, next: 4 });
  });
});
