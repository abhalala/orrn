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

describe("pl-flow 61 tolerance at scan on the phone (parity with web)", () => {
  test("the scan line says both reasons a manager is needed, only for the added bundle", async () => {
    const { addWarningText, tolerancePct } = await import("../features/scan/outcome");
    expect(tolerancePct(500)).toBe("5");
    const report = {
      linked: [{ serial: "26J2", salesOrderLineId: "l1", orderNumber: "SO-4", lineNo: 2 }],
      overTolerance: [{ lineId: "l1", orderNumber: "SO-4", lineNo: 2, toleranceBp: 500, limitG: 1, totalG: 2, overG: 1 }],
      warnings: [{ serial: "26J2", orderNumber: "SO-4", lineNo: 2, bundleMilli: 12_498, lineMilli: 12_000, diffMilli: 498 }],
    };
    expect(addWarningText(t, report, "26J2")).toBe(
      "12.498 kg/12ft, SO-4 says 12.000. Added. A manager has to approve it. Over +5% on SO-4 line 2. A manager has to approve it before Dispatch.",
    );
    expect(addWarningText(t, report, "26J3")).toBeNull();
  });

  test("the dispatch screen lists uncovered lines and where the ask stands; Complete's overdraw refusal in words", async () => {
    const { overdrawLines } = await import("../features/dispatch/off-band");
    const line = { lineId: "l1", orderNumber: "SO-4", lineNo: 2, overG: 30_000, covered: false };
    expect(overdrawLines({ toleranceBp: 500, lines: [line, { ...line, lineId: "l2", covered: true }], approval: { status: "pending" } })).toEqual({
      lines: [{ lineId: "l1", orderNumber: "SO-4", lineNo: 2, overG: 30_000, pct: "5" }],
      statusKey: "dispatch.overTolerance.pending",
    });
    expect(overdrawLines({ toleranceBp: 500, lines: [line], approval: null })?.statusKey).toBe("dispatch.overTolerance.unasked");
    expect(overdrawLines(null)).toBeNull();
    expect(completeRefusalText(t, { message: "Over the order balance: SO-4 line 2 by 30 kg.", data: { code: "PRECONDITION_FAILED" } })).toBe(
      "This load is more than the order allows. A manager has to approve it first. Your note went with the request.",
    );
  });

  test("pl-flow 61 (web parity): the Dispatch sheet's note goes with Complete only while a line is over and something is written", async () => {
    const { overdrawExtras, overdrawLines } = await import("../features/dispatch/off-band");
    const line = { lineId: "l1", orderNumber: "SO-4", lineNo: 2, overG: 30_000, covered: false };
    const over = overdrawLines({ toleranceBp: 500, lines: [line], approval: null });
    expect(overdrawExtras(over, "  Party asked for the full truck ")).toEqual({ overdrawNote: "Party asked for the full truck" });
    expect(overdrawExtras(over, "   ")).toEqual({});
    expect(overdrawExtras(overdrawLines({ toleranceBp: 500, lines: [{ ...line, covered: true }], approval: null }), "note")).toEqual({});
    expect(overdrawExtras(null, "note")).toEqual({});
  });
});

