import { describe, expect, test } from "bun:test";

import { DEMO_BUNDLE, DEMO_PACKING_LIST, demoKg, demoTotalKg } from "./demo-data";

describe("marketing demo data", () => {
  test("bundle numbers use the plant format for October 2026", () => {
    expect(DEMO_PACKING_LIST.map((b) => b.serial)).toEqual(["26J4086", "26J4087", "26J4088", "26J4089"]);
  });

  test("weights show in kg with two decimals, the total with one", () => {
    expect(demoKg(DEMO_BUNDLE)).toBe("52.40");
    expect(demoTotalKg(DEMO_PACKING_LIST)).toBe("206.3");
  });
});
