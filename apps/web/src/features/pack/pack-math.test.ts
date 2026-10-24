import { describe, expect, test } from "bun:test";

import {
  activeYards,
  bundleKgPer12ft,
  chooseYard,
  countOutsideRange,
  draftTotals,
  lengthToInput,
  parsePieces,
  parseWeightG,
  rangeVerdict,
} from "./pack-math";

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

describe("bundleKgPer12ft", () => {
  test("(kg / pcs) / (lengthMm / 304.8) * 12", () => {
    // 52.4 kg, 21 pcs, 12 ft (3658 mm): 52.4/21 = 2.4952 per piece; 3658 mm = 12.0013 ft.
    const k = bundleKgPer12ft({ weightG: 52_400, pieces: 21, lengthMm: 3658 })!;
    expect(k).toBeCloseTo(2.4949, 3);
  });

  test("null without pieces or length", () => {
    expect(bundleKgPer12ft({ weightG: 1000, pieces: 0, lengthMm: 3658 })).toBeNull();
    expect(bundleKgPer12ft({ weightG: 1000, pieces: 2, lengthMm: 0 })).toBeNull();
  });
});

describe("rangeVerdict (billed band /12' vs the die's range)", () => {
  const die = { weightMinG: 2400, weightMaxG: 2600 };

  test("inside the range", () => {
    expect(rangeVerdict(2.4, die)).toBe("in");
    expect(rangeVerdict(2.5, die)).toBe("in");
    expect(rangeVerdict(2.6, die)).toBe("in");
  });

  test("uses the plant's billed band, floor((k + 0.01) * 10) / 10", () => {
    // 2.395 bills as 2.4 (in), 2.689 bills as 2.6 (in), 2.69 and 2.70 bill as 2.7 (above):
    // 2.69 + 0.01 is exactly the 2.7 boundary (domain weightRange12ft keeps it, PL-8 round 3).
    expect(rangeVerdict(2.395, die)).toBe("in");
    expect(rangeVerdict(2.689, die)).toBe("in");
    expect(rangeVerdict(2.69, die)).toBe("above");
    expect(rangeVerdict(2.7, die)).toBe("above");
    expect(rangeVerdict(2.38, die)).toBe("below");
  });

  test("no verdict when the die has no usable range", () => {
    expect(rangeVerdict(2.5, { weightMinG: 0, weightMaxG: 0 })).toBeNull();
    expect(rangeVerdict(2.5, { weightMinG: 3000, weightMaxG: 2000 })).toBeNull();
    expect(rangeVerdict(Number.NaN, die)).toBeNull();
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

describe("countOutsideRange (the session page's 'outside range' chip)", () => {
  const die = { weightMinG: 2400, weightMaxG: 2600 };
  // 3505 mm, 20 pieces: 47.90 kg = 2.50 kg/12ft (in), 40.00 kg = 2.09 (below), 55.00 kg = 2.87 (above).
  const b = (weightG: number, status = "available") => ({ weightG, quantity: 20, lengthMm: 3505, status });

  test("counts bundles below and above the die's range", () => {
    expect(countOutsideRange([b(47_900), b(40_000), b(55_000), b(47_900)], die)).toBe(2);
  });

  test("a void bundle is not counted (it is out of the session's figures)", () => {
    expect(countOutsideRange([b(40_000, "void"), b(47_900)], die)).toBe(0);
  });

  test("no die or no range: nothing to count", () => {
    expect(countOutsideRange([b(40_000)], null)).toBe(0);
    expect(countOutsideRange([b(40_000)], { weightMinG: 0, weightMaxG: 0 })).toBe(0);
  });
});
