import { describe, expect, test } from "bun:test";

import { claimWrite, selectionInItems } from "../features/orders/write-selection";

describe("current selections in hold and release sheets", () => {
  test("selected a, b, c becomes a, c when b leaves the list, and the request count is 2", () => {
    const selected = selectionInItems(new Set(["a", "b", "c"]), [{ id: "a" }, { id: "c" }]);
    expect([...selected]).toEqual(["a", "c"]);
    expect(selected.size).toBe(2);
  });
});

describe("quick Hold taps", () => {
  test("two concurrent submits send one request", async () => {
    const writing = { current: false };
    let requests = 0;
    const submit = async () => {
      if (!claimWrite(writing)) return;
      requests += 1;
      await Promise.resolve();
      writing.current = false;
    };
    await Promise.all([submit(), submit()]);
    expect(requests).toBe(1);
  });
});
