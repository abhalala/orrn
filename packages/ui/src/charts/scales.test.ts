import { describe, expect, test } from "bun:test";

import {
  END_LABEL_MARGIN,
  END_LABEL_REACH,
  capLabelIndices,
  chartDateFormat,
  dateTickTexts,
  placeCapLabel,
  placeEndLabels,
  type Box,
  type EndLabelEnd,
} from "./scales";

/** Shortest distance from a point to a box (0 inside it). */
const reach = (px: number, py: number, b: Box) =>
  Math.hypot(Math.max(b.left - px, 0, px - b.right), Math.max(b.top - py, 0, py - b.bottom));

const bounds = { top: -20, bottom: 200 };

describe("placeEndLabels: a direct label sits next to its own dot or not at all", () => {
  test("ends far apart, no lines in the way: each label level with its dot, directly left of it", () => {
    const ends: EndLabelEnd[] = [
      { key: "a", x: 500, y: 60, width: 60 },
      { key: "b", x: 500, y: 140, width: 80 },
    ];
    const spots = placeEndLabels(ends, [], bounds)!;
    expect(spots.map((s) => s.key)).toEqual(["a", "b"]);
    expect(spots.map((s) => s.base)).toEqual([64.5, 144.5]);
    for (const s of spots) expect(s.box.right).toBe(492);
  });

  test("level and above cross a line: the label drops just below its dot", () => {
    const ends: EndLabelEnd[] = [
      { key: "a", x: 500, y: 100, width: 60 },
      { key: "b", x: 500, y: 170, width: 60 },
    ];
    // Line b runs flat through the spot above a's dot (y 88 to 103).
    const segments = [[380, 95, 490, 95] as const];
    const spots = placeEndLabels(ends, segments, bounds)!;
    expect(spots[0]!.base).toBe(120);
    expect(reach(500, 100, spots[0]!.box)).toBeLessThanOrEqual(END_LABEL_REACH);
  });

  test("every spot within reach crosses a line: no labels, never a far nudge", () => {
    const ends: EndLabelEnd[] = [{ key: "a", x: 500, y: 100, width: 60 }];
    const segments = [[380, 85, 490, 85] as const, [380, 95, 490, 95] as const, [380, 115, 490, 115] as const];
    expect(placeEndLabels(ends, segments, bounds)).toBeNull();
  });

  test("Today's open day: both lines plunge steeply into their dots, labels sit level with them", () => {
    // The 1280px demo: dashed partial segments from ~65 down to the dots.
    const ends: EndLabelEnd[] = [
      { key: "packed", x: 969, y: 139.5, width: 88 },
      { key: "dispatched", x: 969, y: 167.4, width: 112 },
    ];
    const segments = [[958.1, 65, 969, 139.5] as const, [958.1, 65.8, 969, 167.4] as const, [947.2, 60, 958.1, 65] as const];
    const spots = placeEndLabels(ends, segments, { top: -20, bottom: 210 })!;
    expect(spots.map((s) => s.base)).toEqual([144, 171.9]);
  });

  test("dots 8px apart touch: never labelled", () => {
    const ends: EndLabelEnd[] = [
      { key: "a", x: 500, y: 100, width: 50 },
      { key: "b", x: 500, y: 108, width: 50 },
    ];
    expect(placeEndLabels(ends, [], bounds)).toBeNull();
  });

  test("ends 3px apart (packed 7,050.6 vs dispatched 6,900): no labels, the legend names them", () => {
    const ends: EndLabelEnd[] = [
      { key: "packed", x: 500, y: 62.5, width: 50 },
      { key: "dispatched", x: 500, y: 65.7, width: 70 },
    ];
    expect(placeEndLabels(ends, [], bounds)).toBeNull();
  });

  test("every placed label is within reach of its own dot and clearly nearer it than the others", () => {
    for (let gap = 0; gap <= 60; gap += 0.5) {
      const ends: EndLabelEnd[] = [
        { key: "a", x: 500, y: 80, width: 50 },
        { key: "b", x: 500, y: 80 + gap, width: 70 },
      ];
      const spots = placeEndLabels(ends, [], bounds);
      if (!spots) continue;
      for (const s of spots) {
        const own = ends.find((e) => e.key === s.key)!;
        const mine = reach(own.x, own.y, s.box);
        expect(mine).toBeLessThanOrEqual(END_LABEL_REACH);
        for (const other of ends.filter((e) => e.key !== s.key)) {
          expect(reach(other.x, other.y, s.box), `gap ${gap}`).toBeGreaterThan(END_LABEL_REACH);
          expect(reach(other.x, other.y, s.box), `gap ${gap}`).toBeGreaterThanOrEqual(mine + END_LABEL_MARGIN);
        }
      }
    }
  });

  test("a label that would leave the plot is not placed", () => {
    expect(placeEndLabels([{ key: "a", x: 500, y: -14, width: 40 }], [], bounds)?.[0]?.base).toBe(6);
    expect(placeEndLabels([{ key: "a", x: 500, y: -14, width: 40 }], [], { top: -20, bottom: 8 })).toBeNull();
  });
});

describe("placeCapLabel: a value label never enters the y-tick gutter", () => {
  test("centred on its bar when it fits", () => {
    expect(placeCapLabel({ center: 150, width: 60, barLeft: 140, barRight: 160, plotRight: 400 })).toEqual({
      x: 150,
      anchor: "middle",
      left: 120,
      right: 180,
    });
  });

  test("the first bar's label starts at the bar's left edge, inside the plot", () => {
    const cap = placeCapLabel({ center: 11, width: 97, barLeft: 3, barRight: 19, plotRight: 275 });
    expect(cap).toEqual({ x: 3, anchor: "start", left: 3, right: 100 });
  });

  test("the last bar's label ends at the bar's right edge", () => {
    const cap = placeCapLabel({ center: 265, width: 97, barLeft: 257, barRight: 273, plotRight: 279 });
    expect(cap).toEqual({ x: 273, anchor: "end", left: 176, right: 273 });
  });

  test("a label wider than the plot starts at the plot's left edge", () => {
    expect(placeCapLabel({ center: 20, width: 120, barLeft: 10, barRight: 30, plotRight: 80 }).left).toBe(0);
  });
});

describe("capLabelIndices: which bars carry a value label", () => {
  const bars = (values: number[], partialLast = true) =>
    values.map((value, i) => ({ value, partial: partialLast && i === values.length - 1 }));

  test("every complete bar when all labels fit; never the open bucket", () => {
    expect(capLabelIndices(bars([3, 5, 2, 9]), true)).toEqual([0, 1, 2]);
  });

  test("only the tallest complete bar when they do not all fit", () => {
    expect(capLabelIndices(bars([3, 5, 2, 9]), false)).toEqual([1]);
  });

  test("an empty month carries no label: the axis already says 0 (no '0.0 kg' row along the baseline)", () => {
    expect(capLabelIndices(bars([0, 0, 0, 995, 1300]), true)).toEqual([3]);
    expect(capLabelIndices(bars([0, 0, 0, 0]), true)).toEqual([]);
    expect(capLabelIndices(bars([0, 0, 0, 0]), false)).toEqual([]);
  });
});

describe("dates on the x axis carry the year where it changes", () => {
  const months = (from: [number, number], n: number) =>
    Array.from({ length: n }, (_, i) => {
      const m = from[1] - 1 + i;
      const y = from[0] + Math.floor(m / 12);
      return new Date(`${y}-${String((m % 12) + 1).padStart(2, "0")}-01T00:00:00+05:30`).getTime();
    });

  test("chartDateFormat gives a short tick with the year, and the year", () => {
    const en = chartDateFormat("month", "en");
    const oct = new Date("2025-10-01T00:00:00+05:30");
    expect(en.shortWithYear(oct)).toBe("Oct 25");
    expect(en.year(oct)).toBe("2025");
    // Midnight IST on 1 Jan is still 31 Dec in UTC: the year follows the chart's time zone.
    expect(en.year(new Date("2026-01-01T00:00:00+05:30"))).toBe("2026");
    expect(chartDateFormat("day", "en").shortWithYear(oct)).toBe("1 Oct 2025");
  });

  test("13 months across a new year: the first tick and January carry the year", () => {
    const texts = dateTickTexts(months([2025, 10], 13), chartDateFormat("month", "en"));
    expect(texts[0]).toBe("Oct 25");
    expect(texts[3]).toBe("Jan 26");
    expect(texts[12]).toBe("Oct");
    expect(texts.filter((t) => /\d/.test(t))).toEqual(["Oct 25", "Jan 26"]);
  });

  test("thinned ticks: the first drawn tick of the new year carries it", () => {
    const all = months([2025, 10], 13);
    const drawn = [0, 2, 4, 6, 8, 10, 12].map((i) => all[i]!);
    expect(dateTickTexts(drawn, chartDateFormat("month", "en"))).toEqual(["Oct 25", "Dec", "Feb 26", "Apr", "Jun", "Aug", "Oct"]);
  });

  test("ticks inside one year carry no year", () => {
    expect(dateTickTexts(months([2026, 4], 7), chartDateFormat("month", "en"))).toEqual(["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"]);
  });

  test("custom formatters without a year format keep the short text", () => {
    const dates = { long: (d: Date) => d.toISOString(), short: () => "x" };
    expect(dateTickTexts(months([2025, 11], 3), dates)).toEqual(["x", "x", "x"]);
  });
});
