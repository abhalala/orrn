import { describe, expect, test } from "bun:test";

import { bandText, driftChipTone, driftText, kg12Text, positionKey, positionTone, previewReady } from "./line-preview";

describe("pack line verdicts come from the server", () => {
  test("position words and tones: in = green, below / above = amber, none = neutral", () => {
    expect(positionKey("in")).toBe("status.range.inRange");
    expect(positionKey("below")).toBe("status.range.below");
    expect(positionKey("above")).toBe("status.range.above");
    expect(positionKey(null)).toBeNull();
    expect(positionTone("in")).toBe("green");
    expect(positionTone("above")).toBe("amber");
    expect(positionTone(null)).toBe("neutral");
  });

  test("drift chip tone: none hides, under reads blue, the rest as the server says", () => {
    expect(driftChipTone("none")).toBeNull();
    expect(driftChipTone("under")).toBe("blue");
    expect(driftChipTone("green")).toBe("green");
    expect(driftChipTone("amber")).toBe("amber");
    expect(driftChipTone("red")).toBe("red");
  });

  test("drift text prints the server's tenths with a sign (QA 6: the percent and the figure beside it agree)", () => {
    expect(driftText(11)).toBe("+1.1%");
    expect(driftText(-18)).toBe("-1.8%");
    expect(driftText(0)).toBe("+0.0%");
    expect(driftText(null)).toBeNull();
  });

  test("kg/12 ft shows three decimals, so 2.495 is not printed as 2.50 beside a percent that needs 2.495", () => {
    expect(kg12Text(2495)).toBe("2.495");
    expect(kg12Text(6240)).toBe("6.240");
    expect(kg12Text(null)).toBeNull();
  });

  test("band text from grams per 12 ft", () => {
    expect(bandText({ minG: 2200, maxG: 2800 })).toBe("2.2 to 2.8");
    expect(bandText({ minG: 5900, maxG: 6200 })).toBe("5.9 to 6.2");
    expect(bandText({ minG: 2205, maxG: 2810 })).toBe("2.205 to 2.810");
  });

  test("the server is asked only when die, length, weight and pieces are all there", () => {
    expect(previewReady({ dieId: "d", lengthMm: 3505, weightG: 47_900, pieces: 20 })).toBe(true);
    expect(previewReady({ dieId: null, lengthMm: 3505, weightG: 47_900, pieces: 20 })).toBe(false);
    expect(previewReady({ dieId: "d", lengthMm: 0, weightG: 47_900, pieces: 20 })).toBe(false);
    expect(previewReady({ dieId: "d", lengthMm: 3505, weightG: null, pieces: 20 })).toBe(false);
    expect(previewReady({ dieId: "d", lengthMm: 3505, weightG: 47_900, pieces: 0 })).toBe(false);
  });
});
