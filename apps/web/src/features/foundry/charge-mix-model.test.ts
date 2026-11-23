import { describe, expect, test } from "bun:test";

import { MIX_STATUS_TONE, mixRows, outsideElements, predictedRows, shareText, showsCost, targetG } from "./charge-mix-model";

describe("the target", () => {
  test("1 to 100,000 kg in grams; blank, zero and too much are refused", () => {
    expect([targetG("1,000"), targetG("2500.5"), targetG(""), targetG("0.5"), targetG("100001")]).toEqual([1_000_000, 2_500_500, null, null, null]);
  });
});

describe("rows", () => {
  const lines = [
    { key: "lot:a", kind: "lot" as const, label: "L1 · Extrusion 6063", kgG: 600_000 },
    { key: "stream:b", kind: "stream" as const, label: "Dross ingot", kgG: 200_000 },
    { key: "lot:c", kind: "lot" as const, label: "L2", kgG: 0 },
    { key: "lot:d", kind: "lot" as const, label: "L3", kgG: 200_000 },
  ];
  test("heaviest first, shares add to the whole, empty lines drop", () => {
    const r = mixRows(lines);
    expect(r.map((x) => [x.key, x.shareBp])).toEqual([["lot:a", 6_000], ["stream:b", 2_000], ["lot:d", 2_000]]);
    expect(shareText(2_534)).toBe("25.3");
    expect(mixRows([])).toEqual([]);
  });
});

describe("predicted chemistry", () => {
  const words = { max: "max", min: "min", to: "to" };
  const p = [
    { element: "si", ppm: 4_500, minPpm: 2_000, maxPpm: 6_000, ok: true },
    { element: "fe", ppm: 3_800, minPpm: null, maxPpm: 3_500, ok: false },
    { element: "mg", ppm: 3_000, minPpm: 4_500, maxPpm: null, ok: false },
    { element: "zn", ppm: 100, minPpm: null, maxPpm: null, ok: true },
  ];
  test("percent beside the limit in the plain words", () => {
    expect(predictedRows(p, words)).toEqual([
      { element: "si", pct: "0.450", limit: "0.20 to 0.60", ok: true },
      { element: "fe", pct: "0.380", limit: "max 0.35", ok: false },
      { element: "mg", pct: "0.300", limit: "min 0.45", ok: false },
      { element: "zn", pct: "0.010", limit: "", ok: true },
    ]);
    expect(outsideElements(p)).toEqual(["fe", "mg"]);
  });
});

describe("status and cost", () => {
  test("tones", () => {
    expect([MIX_STATUS_TONE.ok, MIX_STATUS_TONE.outside_limits, MIX_STATUS_TONE.short_metal, MIX_STATUS_TONE.no_sources]).toEqual(["green", "amber", "red", "neutral"]);
  });
  test("cost is hidden when the server sends null; zero is a figure", () => {
    expect([showsCost(null), showsCost(undefined), showsCost(0), showsCost(1850000)]).toEqual([false, false, true, true]);
  });
});
