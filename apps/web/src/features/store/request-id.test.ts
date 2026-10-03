import { describe, expect, test } from "bun:test";

import { createRequestIds } from "./request-id";

function counter() {
  let n = 0;
  return () => `id-${++n}`;
}

describe("createRequestIds (RP18: double taps never double-post)", () => {
  test("the same entry keeps the same key across taps and retries", () => {
    const ids = createRequestIds(counter());
    const a = ids.idFor("issue|flux|12500|melt");
    expect(ids.idFor("issue|flux|12500|melt")).toBe(a);
    expect(ids.idFor("issue|flux|12500|melt")).toBe(a);
  });

  test("changing what is entered makes a new key (it is a different entry)", () => {
    const ids = createRequestIds(counter());
    const a = ids.idFor("issue|flux|12500|melt");
    const b = ids.idFor("issue|flux|13000|melt");
    expect(b).not.toBe(a);
  });

  test("after a saved entry, the next one gets a fresh key even with the same values", () => {
    const ids = createRequestIds(counter());
    const a = ids.idFor("receive|ldo|200000|");
    ids.reset();
    expect(ids.idFor("receive|ldo|200000|")).not.toBe(a);
  });

  test("default generator gives distinct uuids", () => {
    const ids = createRequestIds();
    const a = ids.idFor("x");
    ids.reset();
    const b = ids.idFor("x");
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
  });
});
