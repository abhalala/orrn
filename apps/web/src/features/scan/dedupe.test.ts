import { describe, expect, test } from "bun:test";

import { createDeduper } from "./dedupe";

describe("createDeduper", () => {
  test("a value read again inside the window is dropped", () => {
    let t = 0;
    const d = createDeduper(1500, () => t);
    expect(d.accept("26I4086")).toBe(true);
    t = 200;
    expect(d.accept("26I4086")).toBe(false);
    t = 1400;
    expect(d.accept("26I4086")).toBe(false);
  });

  test("a label held in view stays read once; out of sight for the window, it reads again", () => {
    let t = 0;
    const d = createDeduper(1500, () => t);
    expect(d.accept("A")).toBe(true);
    for (t = 100; t <= 5000; t += 100) expect(d.accept("A")).toBe(false);
    t = 5000 + 1500;
    expect(d.accept("A")).toBe(true);
  });

  test("different values pass straight through", () => {
    let t = 0;
    const d = createDeduper(1500, () => t);
    expect(d.accept("A")).toBe(true);
    t = 10;
    expect(d.accept("B")).toBe(true);
    expect(d.accept("A")).toBe(false);
  });

  test("reset forgets everything", () => {
    const d = createDeduper(1500, () => 0);
    d.accept("A");
    d.reset();
    expect(d.accept("A")).toBe(true);
  });
});
