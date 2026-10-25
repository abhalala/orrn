import { describe, expect, test } from "bun:test";

import { planDieView } from "./planView";

describe("planDieView (FP-OP-21)", () => {
  test("worked example: two lengths planned, one logged run, pressed per length", () => {
    // 12 ft: 100 pcs / 500 kg + 50 pcs / 250 kg (two orders); 16 ft: 300 kg on kg basis.
    const v = planDieView({
      planLines: [
        { cutLengthMm: 3658, pcs: 100, kgG: 500_000 },
        { cutLengthMm: 3658, pcs: 50, kgG: 250_000 },
        { cutLengthMm: 4877, pcs: null, kgG: 300_000 },
      ],
      runs: [{ id: "r1", status: "logged", createdAt: 1 }],
      runLines: [
        { pressRunId: "r1", cutLengthMm: 3658, pcs: 120, goodG: 598_000 },
        { pressRunId: "r1", cutLengthMm: 4877, pcs: 40, goodG: 265_500 },
      ],
    });
    expect(v.lengths).toEqual([
      { cutLengthMm: 3658, plannedPcs: 150, plannedG: 750_000, pressedPcs: 120, pressedG: 598_000 },
      { cutLengthMm: 4877, plannedPcs: 0, plannedG: 300_000, pressedPcs: 40, pressedG: 265_500 },
    ]);
    expect(v).toMatchObject({ plannedPcs: 150, plannedG: 1_050_000, pressedPcs: 160, pressedG: 863_500, state: "logged" });
    // 863.5 / 1050 = 82.238...% -> 8224 bp
    expect(v.pressedBp).toBe(8224);
  });

  test("only logged runs count; a running run is the chip; a voided run is ignored", () => {
    const v = planDieView({
      planLines: [{ cutLengthMm: 3658, pcs: 10, kgG: 50_000 }],
      runs: [
        { id: "old", status: "voided", createdAt: 3 },
        { id: "now", status: "running", createdAt: 2 },
      ],
      runLines: [{ pressRunId: "now", cutLengthMm: 3658, pcs: 5, goodG: 25_000 }],
    });
    expect(v).toMatchObject({ pressedPcs: 0, pressedG: 0, pressedBp: 0, state: "running" });
  });

  test("a pressed length that was not planned is listed with planned 0; nothing planned = 0 bp; no run = not_started", () => {
    const v = planDieView({ planLines: [], runs: [], runLines: [] });
    expect(v).toMatchObject({ lengths: [], pressedBp: 0, state: "not_started" });
    const w = planDieView({
      planLines: [{ cutLengthMm: 3658, pcs: 10, kgG: 50_000 }],
      runs: [{ id: "r", status: "logged", createdAt: 1 }],
      runLines: [{ pressRunId: "r", cutLengthMm: 3048, pcs: 3, goodG: 12_000 }],
    });
    expect(w.lengths.map((l) => [l.cutLengthMm, l.plannedG, l.pressedG])).toEqual([
      [3048, 0, 12_000],
      [3658, 50_000, 0],
    ]);
  });
});
