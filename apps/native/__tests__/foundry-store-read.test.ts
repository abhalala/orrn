import { describe, expect, test } from "bun:test";

import { storeReadState } from "../features/foundry/store-read";

describe("store list failure in the melt editor", () => {
  test("a failed first read becomes inline chemicals state, not a whole-editor failure", () => {
    const error = new Error("offline");
    expect(storeReadState(undefined, error)).toEqual({ items: [], inlineError: error });
  });

  test("a failed refresh keeps prior items and still offers an inline retry", () => {
    const error = new Error("offline");
    const items = [{ id: "flux", name: "Flux", unit: "kg", active: true }];
    expect(storeReadState({ items }, error)).toEqual({ items, inlineError: error });
  });

  test("a successful read has no inline error", () => {
    const items = [{ id: "flux", name: "Flux", unit: "kg", active: true }];
    expect(storeReadState({ items }, null)).toEqual({ items, inlineError: null });
  });
});
