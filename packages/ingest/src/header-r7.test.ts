import { describe, expect, test } from "bun:test";

import { chooseHeader, type HeaderHoles } from "./header";
import { readSheet } from "./readers/blocks";
import { layoutOf } from "./readers/trust-helpers";

// Round 7, rule 6.3 (M-R6-4): a row is trusted through a layout with at least two named columns, at least one of
// them a real name (not blank and not only a unit word), all matched exactly. A layout of only blanks and unit
// words never is (the round 5 case U1 stays closed; its test is in header-r6.test.ts).
const choose = (m: string[][], holes: HeaderHoles) => chooseHeader(readSheet(m).blocks[0]!, holes);

describe("6.3: small layouts", () => {
  const same = (head: string[], rows: string[][]) => {
    const b = readSheet([head, ...rows]).blocks[0]!;
    return chooseHeader(b, { learned: [layoutOf(b.headers, "small")] });
  };

  test("an approved small layout fits the same file again (r6a)", () => {
    expect(same(["Party", "Kg"], [["Om", "12"], ["Mehta", "13"]])).toMatchObject({ kind: "fits", headerRow: 0 });
    expect(same(["Section", "Pcs", "Kg"], [["T4012", "12", "340"], ["T4013", "8", "210"]])).toMatchObject({ kind: "fits", headerRow: 0 });
    expect(same(["No.", "Party", "Kg"], [["1", "Om", "12"], ["2", "Mehta", "13"]])).toMatchObject({ kind: "fits", headerRow: 0 });
  });

  test("a layout of only blanks and unit words is never trusted", () => {
    expect(same(["Kg", "Pcs"], [["12", "4"], ["13", "5"]]).kind).toBe("ask");
    expect(same(["", "Kg", "Pcs"], [["Angle", "12.5", "4"], ["Tee", "13", "5"]]).kind).toBe("ask");
    expect(same(["%", "#"], [["12", "4"], ["13", "5"]]).kind).toBe("ask");
  });

  test("one named column is not enough, even a real name", () => {
    const one = layoutOf(["Party", ""], "one-name");
    const c = choose([["Party", ""], ["Om", "12"], ["Mehta", "13"]], { learned: [one] });
    expect(c.kind === "fits" && c.fit.name === "one-name").toBe(false);
  });

  test("U1 stays closed: a units row under a header never fits a layout of a blank and unit words", () => {
    const U = layoutOf(["", "Kg", "Pcs"], "unit-cols");
    expect(choose([["Item", "Weight", "Qty"], ["", "Kgs", "Pcs"], ["Angle", "12.5", "4"], ["Tee", "13", "5"]], { learned: [U] }).kind).toBe("ask");
  });
});
