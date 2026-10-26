import { describe, expect, test } from "bun:test";

import { draftWithKey, firstSaveKey, type FirstSave } from "../features/foundry/first-save";

let n = 0;
const fresh = () => `id-${++n}`;

describe("the key of the first save of a melt (W2-FD-N review I-1)", () => {
  test("the first send makes an id and remembers the content it was made for", () => {
    n = 0;
    const r = firstSaveKey(null, { a: 1 }, fresh);
    expect(r.id).toBe("id-1");
    expect(r.held).toEqual({ id: "id-1", payload: JSON.stringify({ a: 1 }) });
    expect(r.sameContent).toBe(true);
  });

  test("edited content after an unsure answer keeps the SAME id: a second draft is never opened", () => {
    n = 0;
    const first = firstSaveKey(null, { a: 1 }, fresh);
    const edited = firstSaveKey(first.held, { a: 2 }, fresh);
    expect(edited.id).toBe(first.id);
    expect(edited.sameContent).toBe(false);
    // and again, and back to the first content
    const again = firstSaveKey(edited.held, { a: 3 }, fresh);
    expect(again.id).toBe(first.id);
    expect(firstSaveKey(again.held, { a: 1 }, fresh).sameContent).toBe(true);
    expect(n).toBe(1);
  });

  test("the content the id was first made for stays the reference, however often the form is edited", () => {
    const first = firstSaveKey(null, "A", fresh);
    const second = firstSaveKey(first.held, "B", fresh);
    expect(second.held.payload).toBe(JSON.stringify("A"));
  });

  test("after a definite answer the holder is cleared by the caller (null) and the next first save gets a new id", () => {
    const held: FirstSave = null;
    expect(firstSaveKey(held, "x", () => "fresh-1").id).toBe("fresh-1");
  });
});

describe("finding the draft an unsure first save made", () => {
  const melts = [
    { id: "m1", clientRequestId: "other", serverSeq: 4 },
    { id: "m2", clientRequestId: "id-9", serverSeq: 7 },
    { id: "m3", clientRequestId: null, serverSeq: 9 },
  ];

  test("the cast's melts are searched by the key", () => {
    expect(draftWithKey(melts, "id-9")).toEqual({ id: "m2", serverSeq: 7 });
  });

  test("no melt carries the key: nothing landed, the save goes out with the same key", () => {
    expect(draftWithKey(melts, "id-404")).toBeNull();
    expect(draftWithKey(undefined, "id-9")).toBeNull();
    expect(draftWithKey(melts, "")).toBeNull();
  });
});
