import { describe, expect, test } from "bun:test";

import { OFF_BAND_TONE, offBandNote, offBandStatusKey, offBandStops } from "./off-band";

const sum = (over: Partial<{ pending: number; rejected: number; unasked: number; approved: number }>) => {
  const s = { pending: 0, rejected: 0, unasked: 0, approved: 0, ...over };
  return { ...s, blocked: s.pending + s.rejected > 0 };
};

describe("Q36 off-band rows on the dispatch screen", () => {
  test("Dispatch waits while a row is waiting or rejected, not for approved or not-yet-asked rows", () => {
    expect(offBandStops(sum({ pending: 1 }))).toBe(true);
    expect(offBandStops(sum({ rejected: 1 }))).toBe(true);
    expect(offBandStops(sum({ approved: 3, unasked: 1 }))).toBe(false);
    expect(offBandStops(null)).toBe(false);
  });

  test("the note says the rejected rows first, then the waiting ones, then what Dispatch will ask", () => {
    expect(offBandNote(sum({ pending: 2, rejected: 1 }))).toEqual({ key: "dispatch.offBand.rejectedNote", count: 1 });
    expect(offBandNote(sum({ pending: 2 }))).toEqual({ key: "dispatch.offBand.waiting", count: 2 });
    expect(offBandNote(sum({ unasked: 1 }))).toEqual({ key: "dispatch.offBand.unasked", count: 1 });
    expect(offBandNote(sum({ approved: 4 }))).toBeNull();
    expect(offBandNote(undefined)).toBeNull();
  });

  test("each status has a key and a tone", () => {
    expect(offBandStatusKey("pending")).toBe("dispatch.offBand.pending");
    expect(OFF_BAND_TONE).toEqual({ pending: "amber", approved: "green", rejected: "red", none: "amber" });
  });
});
