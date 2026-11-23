import { describe, expect, test } from "bun:test";

import { progressParts } from "./order-progress";

describe("progressParts", () => {
  test("keeps the stages with kg, in plant order", () => {
    expect(
      progressParts({ stage: "packed", notPlannedG: 75_000, plannedG: 0, onPressG: 0, ageingG: 0, unpackedG: 0, packedG: 15_000, dispatchedG: 10_000 }),
    ).toEqual([
      { stage: "notPlanned", g: 75_000 },
      { stage: "packed", g: 15_000 },
      { stage: "dispatched", g: 10_000 },
    ]);
  });
  test("no progress is no parts", () => {
    expect(progressParts(null)).toEqual([]);
  });
});
