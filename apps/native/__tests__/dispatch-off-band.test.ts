import { describe, expect, test } from "bun:test";

import { createI18n } from "@orrn/i18n";

import { completeRefusalText, OFF_BAND_TONE, offBandNote, offBandStatusKey, offBandStops } from "../features/dispatch/off-band";

const sum = (over: Partial<{ pending: number; rejected: number; unasked: number; approved: number }>) => {
  const s = { pending: 0, rejected: 0, unasked: 0, approved: 0, ...over };
  return { ...s, blocked: s.pending + s.rejected > 0 };
};
const { t } = createI18n("en");

describe("Q36 off-band rows on the phone's dispatch screen (parity with web)", () => {
  test("Dispatch waits while a row is waiting or rejected", () => {
    expect(offBandStops(sum({ pending: 1 }))).toBe(true);
    expect(offBandStops(sum({ rejected: 1 }))).toBe(true);
    expect(offBandStops(sum({ approved: 2, unasked: 1 }))).toBe(false);
    expect(offBandStops(undefined)).toBe(false);
  });

  test("the note: rejected first, then waiting, then what Dispatch asks", () => {
    expect(offBandNote(sum({ pending: 1, rejected: 2 }))).toEqual({ key: "dispatch.offBand.rejectedNote", count: 2 });
    expect(offBandNote(sum({ pending: 1 }))).toEqual({ key: "dispatch.offBand.waiting", count: 1 });
    expect(offBandNote(sum({ unasked: 3 }))).toEqual({ key: "dispatch.offBand.unasked", count: 3 });
    expect(offBandNote(sum({}))).toBeNull();
    expect(t("dispatch.offBand.waiting", { count: 1 })).toBe("1 bundle waits for a manager to approve the weight. Dispatch opens when each one is decided.");
  });

  test("status words and tones", () => {
    expect(offBandStatusKey("rejected")).toBe("dispatch.offBand.rejected");
    expect(OFF_BAND_TONE.approved).toBe("green");
  });

  test("a refused Complete is said in the floor's words; anything else is left to the generic text", () => {
    const err = (message: string, code = "PRECONDITION_FAILED") => ({ message, data: { code } });
    expect(completeRefusalText(t, err("KJ-1 is more than 0.1 kg/12ft off the order line. A manager has to approve."))).toBe(
      "Some bundles are off the order weight. A manager has to approve them before this dispatch can go.",
    );
    expect(completeRefusalText(t, err("KJ-2 was rejected for the order line. Take it off the dispatch."))).toBe(
      "A bundle was rejected for the order weight. Take it off this dispatch, then try again.",
    );
    expect(completeRefusalText(t, err("Loaded 9 kg is 1 kg over"))).toBeNull();
    expect(completeRefusalText(t, err("off the order line", "CONFLICT"))).toBeNull();
  });
});
