import { describe, expect, test } from "bun:test";

import { gramsToFieldText, gramsToKgText, scalePollMs, scaleView, typedWeightNeedsReason, weightProvenance } from "./scale-view";

const base = { configured: true, simulated: false, nodeId: "n1" };

describe("scale view", () => {
  test("no reading yet, or no scale: off, and a typed weight needs no reason", () => {
    expect(scaleView(undefined)).toEqual({ state: "off" });
    expect(scaleView({ stable: false, reason: "no_node", configured: false, simulated: false, nodeId: null })).toEqual({ state: "off" });
    expect(typedWeightNeedsReason(scaleView(undefined))).toBe(false);
  });

  test("a steady weight is the only one that can fill the field", () => {
    expect(scaleView({ ...base, stable: true, grams: 52_400, ageMs: 80 })).toEqual({ state: "stable", simulated: false, grams: 52_400 });
    expect(scaleView({ ...base, stable: false, grams: 52_445, reason: "settling" })).toEqual({ state: "waiting", simulated: false, grams: 52_445 });
  });

  test("a steady 0 is not a weight", () => {
    // The server already says stable false with reason zero; a stale client must not fill 0.
    expect(scaleView({ ...base, stable: true, grams: 0 }).state).toBe("waiting");
    expect(scaleView({ ...base, stable: false, grams: 0, reason: "zero" })).toEqual({ state: "waiting", simulated: false, grams: null });
  });

  test("a scale that stopped sending is silent, and typing still asks a reason", () => {
    for (const reason of ["stale", "no_frames", "unreachable", "node_inactive", "bad_answer"]) {
      const v = scaleView({ ...base, stable: false, reason });
      expect(v.state).toBe("silent");
      expect(typedWeightNeedsReason(v)).toBe(true);
    }
  });

  test("polling is quick with a scale and lazy without one", () => {
    expect(scalePollMs(null)).toBe(800);
    expect(scalePollMs({ state: "off" })).toBe(20_000);
    expect(scalePollMs({ state: "stable", simulated: false, grams: 1 })).toBe(800);
  });

  test("grams to text", () => {
    expect(gramsToFieldText(52_400)).toBe("52.4");
    expect(gramsToFieldText(52_405)).toBe("52.405");
    expect(gramsToKgText(52_400)).toBe("52.40");
  });

  test("provenance: untouched scale weight is scale, anything else is typed and keeps the reading as evidence", () => {
    expect(weightProvenance({ weightG: 52_400, filledFromG: 52_400, lastStableG: 52_400 })).toEqual({ weightSource: "scale", scaleReadingG: 52_400 });
    expect(weightProvenance({ weightG: 52_000, filledFromG: 52_400, lastStableG: 52_400 })).toEqual({ weightSource: "manual", scaleReadingG: 52_400 });
    expect(weightProvenance({ weightG: 52_000, filledFromG: null, lastStableG: null })).toEqual({ weightSource: "manual" });
  });
});
