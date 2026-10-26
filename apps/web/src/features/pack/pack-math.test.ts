import { describe, expect, test } from "bun:test";

import { activeYards, chooseYard, draftTotals, lengthToInput, parsePieces, parseWeightG } from "./pack-math";

describe("parseWeightG (kg text to whole grams)", () => {
  test("decimal kg to grams", () => {
    expect(parseWeightG("52.4")).toBe(52_400);
    expect(parseWeightG("52.40")).toBe(52_400);
    expect(parseWeightG(" 1,052.125 ")).toBe(1_052_125);
    expect(parseWeightG("0.5")).toBe(500);
  });

  test("rounds below a gram", () => {
    expect(parseWeightG("1.0004")).toBe(1000);
    expect(parseWeightG("1.0006")).toBe(1001);
  });

  test("rejects empty, zero, junk and negatives", () => {
    for (const bad of ["", "0", "0.0", "0.0001", "-1", "abc", "1.2.3", "1e3"]) {
      expect(parseWeightG(bad)).toBeNull();
    }
  });
});

describe("parsePieces", () => {
  test("whole positive numbers", () => {
    expect(parsePieces("21")).toBe(21);
    expect(parsePieces(" 7 ")).toBe(7);
    expect(parsePieces("1,000")).toBe(1000);
  });

  test("rejects zero, fractions, junk", () => {
    for (const bad of ["", "0", "2.5", "-3", "x", "100001"]) {
      expect(parsePieces(bad)).toBeNull();
    }
  });
});

describe("lengthToInput (stored mm back to the fields)", () => {
  test("inch companies get feet and inches", () => {
    expect(lengthToInput(3505, "inch")).toEqual({ mm: "", feet: "11", inches: "6" });
    expect(lengthToInput(3658, "inch")).toEqual({ mm: "", feet: "12", inches: "" });
    expect(lengthToInput(3664, "inch")).toEqual({ mm: "", feet: "12", inches: "0.25" });
  });

  test("mm companies get mm", () => {
    expect(lengthToInput(3505, "mm")).toEqual({ mm: "3505", feet: "", inches: "" });
  });

  test("nothing set", () => {
    expect(lengthToInput(0, "inch")).toEqual({ mm: "", feet: "", inches: "" });
  });
});

describe("draftTotals", () => {
  test("sums bundles, pieces and grams", () => {
    expect(
      draftTotals([
        { weightG: 52_400, pieces: 21 },
        { weightG: 50_150, pieces: 20 },
      ]),
    ).toEqual({ bundles: 2, pieces: 41, weightG: 102_550 });
    expect(draftTotals([])).toEqual({ bundles: 0, pieces: 0, weightG: 0 });
  });
});

describe("activeYards (where packed bundles can go)", () => {
  const loc = (code: string, kind: string, active = true) => ({ id: `id-${code}`, code, name: code, kind, active });
  test("only active yards, in the server's order", () => {
    const items = [loc("Y2", "yard"), loc("BILLET", "billet_store"), loc("Y1", "yard"), loc("Y9", "yard", false), loc("SCRAP", "scrap_store")];
    expect(activeYards(items).map((y) => y.code)).toEqual(["Y2", "Y1"]);
  });
  test("a company without yards gets none (no yard question)", () => {
    expect(activeYards([loc("STORE", "store")])).toEqual([]);
    expect(activeYards(undefined)).toEqual([]);
  });
});

describe("chooseYard (which yard tile starts selected)", () => {
  const yards = [
    { id: "y1", code: "Y1", name: "Yard 1" },
    { id: "y2", code: "Y2", name: "Yard 2" },
  ];
  test("the draft's own yard wins while it is still active", () => {
    expect(chooseYard({ current: "y2", lastUsed: "y1", yards })).toBe("y2");
  });
  test("a fresh session starts on the yard last packed into on this device", () => {
    expect(chooseYard({ current: undefined, lastUsed: "y1", yards })).toBe("y1");
  });
  test("a retired yard is never offered; nothing is selected rather than guessing", () => {
    expect(chooseYard({ current: "y9", lastUsed: "y8", yards })).toBeUndefined();
    expect(chooseYard({ current: "y9", lastUsed: "y1", yards })).toBe("y1");
    expect(chooseYard({ current: undefined, lastUsed: null, yards })).toBeUndefined();
  });
  test("no yards, no selection", () => {
    expect(chooseYard({ current: "y1", lastUsed: "y1", yards: [] })).toBeUndefined();
  });
});
