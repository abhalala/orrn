import { describe, expect, test } from "bun:test";

import { isUnitOnlyName, normalizeHeader } from "./fingerprint";
import { chooseHeader, type HeaderHoles } from "./header";
import { readSheet } from "./readers/blocks";
import { layoutOf } from "./readers/trust-helpers";

// Round 6, item 1 (B-R5-2): a row is trusted only through a layout with two real names matched exactly.
const choose = (m: string[][], holes: HeaderHoles) => chooseHeader(readSheet(m).blocks[0]!, holes);

describe("round 6: a layout needs two real names to be trusted", () => {
  test("U1: a units row under an unknown header never fits a layout of a blank and unit words", () => {
    const U = layoutOf(["", "Kg", "Pcs"], "unit-cols");
    const c = choose([["Item", "Weight", "Qty"], ["", "Kgs", "Pcs"], ["Angle", "12.5", "4"], ["Tee", "13", "5"]], { learned: [U] });
    expect(c.kind).toBe("ask");
    if (c.kind === "ask") expect(c.resembles).toMatchObject({ headerRow: 1, fit: "exact", name: "unit-cols" });
  });

  // Round 7, rule 6.3 (M-R6-4): two named columns with one real name are enough. This test pinned "Party | Kg" as
  // asking; it now pins it as fitting, and keeps the layout of a blank and unit words asking.
  test("the same sheet as the layout itself: unit words alone still ask, Party | Kg now fits", () => {
    const U = layoutOf(["", "Kg", "Pcs"], "unit-cols");
    expect(choose([["", "Kg", "Pcs"], ["Angle", "12.5", "4"], ["Tee", "13", "5"]], { learned: [U] }).kind).toBe("ask");
    const T2 = layoutOf(["Party", "Kg"], "party-kg");
    expect(choose([["Party", "Kg"], ["Om", "12"], ["Mehta", "13"]], { learned: [T2] })).toMatchObject({ kind: "fits", headerRow: 0 });
  });

  test("two real names and unit columns fit", () => {
    const L = layoutOf(["Party", "Section", "Kg", "Pcs"], "ob");
    expect(choose([["Party", "Section", "Kg", "Pcs"], ["Om", "T4012", "12", "4"], ["Mehta", "T4013", "13", "5"]], { learned: [L] })).toMatchObject({ kind: "fits", headerRow: 0 });
  });

  test("unit-only names", () => {
    // Round 8, rule 8.2: "12 ft" is "12ft", which was already unit-only like "kg/12ft"; it moved from the second list.
    for (const n of ["Kg", "Kgs", "Pcs", "Nos", "kg/12ft", "Rs.", "%", "mm", "", "12 ft"]) expect(isUnitOnlyName(normalizeHeader(n)), n).toBe(true);
    for (const n of ["Party", "Weight kg", "Cut Length", "12", "Section", "नाम"]) expect(isUnitOnlyName(normalizeHeader(n)), n).toBe(false);
  });
});
