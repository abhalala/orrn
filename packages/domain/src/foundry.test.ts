import { describe, expect, test } from "bun:test";

import {
  CAST_TAIL_REASON_BP,
  MELT_BALANCE_WARN_BP,
  castTail,
  meltBalance,
} from "./foundry";

const KG = 1000;

describe("meltBalance (spec P15: |in - out| within 3 % warns, never silently passes)", () => {
  test("a normal melt: 2 % loss is burn loss, inside the band, no warning", () => {
    const b = meltBalance({ inputG: 10_000 * KG, outputG: 9_800 * KG });
    expect(b).toEqual({
      lossG: 200 * KG,
      lossBp: 200,
      allowedBurnG: 200 * KG,
      excessBurnG: 0,
      warning: null,
    });
  });

  test("exactly 3 % is still inside the band", () => {
    const b = meltBalance({ inputG: 10_000 * KG, outputG: 9_700 * KG });
    expect(b.lossBp).toBe(MELT_BALANCE_WARN_BP);
    expect(b.warning).toBeNull();
    expect(b.allowedBurnG).toBe(300 * KG);
  });

  test("more than 3 % lost warns; only 3 % counts as burn, the rest is excess", () => {
    const b = meltBalance({ inputG: 10_000 * KG, outputG: 9_650 * KG });
    expect(b.warning).toBe("loss_high");
    expect(b.lossBp).toBe(350);
    expect(b.allowedBurnG).toBe(300 * KG);
    expect(b.excessBurnG).toBe(50 * KG);
  });

  test("more out than in is impossible: warns, no burn allowance", () => {
    const b = meltBalance({ inputG: 10_000 * KG, outputG: 10_010 * KG });
    expect(b.warning).toBe("out_exceeds_in");
    expect(b.lossG).toBe(-10 * KG);
    expect(b.lossBp).toBe(-10);
    expect(b.allowedBurnG).toBe(0);
    expect(b.excessBurnG).toBe(0);
  });

  test("integer grams only: 3 % of an odd input floors, so the band never widens", () => {
    const b = meltBalance({ inputG: 333, outputG: 323 });
    // 3 % of 333 g = 9.99 g -> 9 g allowed; 10 g lost is outside.
    expect(b.allowedBurnG).toBe(9);
    expect(b.excessBurnG).toBe(1);
    expect(b.warning).toBe("loss_high");
  });

  test("rejects non-integer or negative grams", () => {
    expect(() => meltBalance({ inputG: 1.5, outputG: 1 })).toThrow(RangeError);
    expect(() => meltBalance({ inputG: 10, outputG: -1 })).toThrow(RangeError);
    expect(() => meltBalance({ inputG: 0, outputG: 0 })).toThrow(RangeError);
  });
});

describe("castTail (Review Focus 4: an unexplained tail needs a reason)", () => {
  const base = {
    inputG: 60_000 * KG,
    byproductG: 1_200 * KG,
    allowedBurnG: 1_500 * KG,
    bundlesG: 40_000 * KG,
    pressReturnsG: 4_000 * KG,
    billetsOnHandG: 13_300 * KG,
  };

  test("everything explained: tail 0, no reason needed", () => {
    expect(castTail(base)).toEqual({ explainedG: 60_000 * KG, tailG: 0, tailBp: 0, needsReason: false });
  });

  test("a 1 % tail is the limit; above it needs a reason", () => {
    const at = castTail({ ...base, bundlesG: base.bundlesG - 600 * KG });
    expect(at).toMatchObject({ tailG: 600 * KG, tailBp: CAST_TAIL_REASON_BP, needsReason: false });
    const over = castTail({ ...base, bundlesG: base.bundlesG - 601 * KG });
    expect(over.needsReason).toBe(true);
    expect(over.tailBp).toBe(100);
  });

  test("a negative tail (more explained than went in) beyond 1 % needs a reason too", () => {
    const t = castTail({ ...base, billetsOnHandG: base.billetsOnHandG + 1_000 * KG });
    expect(t.tailG).toBe(-1_000 * KG);
    expect(t.needsReason).toBe(true);
  });

  test("a cast with no input: zero tail closes, anything else needs a reason", () => {
    const empty = { inputG: 0, byproductG: 0, allowedBurnG: 0, bundlesG: 0, pressReturnsG: 0, billetsOnHandG: 0 };
    expect(castTail(empty)).toEqual({ explainedG: 0, tailG: 0, tailBp: null, needsReason: false });
    expect(castTail({ ...empty, bundlesG: 5 }).needsReason).toBe(true);
  });
});

describe("final explore L10: spectro values read as symbols", () => {
  test("si, FE, mg → Si, Fe, Mg", () => {
    const { elementSymbol } = require("./foundry") as typeof import("./foundry");
    expect(["si", "FE", "mg", "al", ""].map(elementSymbol)).toEqual(["Si", "Fe", "Mg", "Al", ""]);
  });
});
