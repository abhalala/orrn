import { describe, expect, test } from "bun:test";

import { hasNextCursor, hasNextOffset, listViewState } from "../features/more/list-state";

describe("new list paging and states", () => {
  test("nitriding offset pages stop at the end", () => {
    expect(hasNextOffset(0, 50, 120)).toBe(true);
    expect(hasNextOffset(50, 50, 120)).toBe(true);
    expect(hasNextOffset(100, 50, 120)).toBe(false);
    expect(hasNextOffset(0, 50, 50)).toBe(false);
  });

  test("maker cursors stop only when the server returns null", () => {
    expect(hasNextCursor("cursor-2")).toBe(true);
    expect(hasNextCursor(null)).toBe(false);
    expect(hasNextCursor(undefined)).toBe(false);
  });

  test("first-page empty, loading and per-page errors are distinct states", () => {
    expect(listViewState(undefined, null, false, 0)).toBe("loading");
    expect(listViewState(undefined, new Error("offline"), true, 0)).toBe("error");
    expect(listViewState({ items: [], total: 0 }, null, false, 0)).toBe("empty");
    expect(listViewState({ items: [{ id: "copy-1" }], total: 1 }, null, false, 0)).toBe("rows");
    expect(listViewState({ items: [], total: 50 }, null, false, 50)).toBe("rows");
  });
});
