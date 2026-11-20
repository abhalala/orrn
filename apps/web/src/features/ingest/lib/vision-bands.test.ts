import { describe, expect, test } from "bun:test";
import { VISION_PARAMS } from "@orrn/ingest";

import {
  bandCountFor,
  blankRows,
  cutBands,
  inkLines,
  inkRows,
  pageTextJson,
  planScanBands,
  planTextBands,
  scanBandCount,
  textLines,
  type Band,
  type TextBox,
} from "./vision-bands";

const WIDTH = VISION_PARAMS.longSidePx;
const PITCH = 30;
const TEXT_ROWS = 20;
const TOP = 120;

/**
 * A synthetic page: `lines` text lines `PITCH` rows apart, each `TEXT_ROWS` rows of ink; a title line with one box at
 * the top, then a header line and body lines with `cols` boxes. `rule` ink sits in every row of the table (vertical
 * rules). `touch` makes each box's span reach the next line, as tight pdfjs boxes do.
 */
function page(lines: number, opts: { rule?: number; touch?: boolean; cols?: number } = {}) {
  const cols = opts.cols ?? 10;
  const height = TOP + (lines + 2) * PITCH + 200;
  const ink = new Uint32Array(height);
  const boxes: TextBox[] = [];
  const spans: Band[] = [];
  for (let i = 0; i < lines; i += 1) {
    const top = TOP + i * PITCH;
    const bottom = top + TEXT_ROWS;
    spans.push({ top, bottom });
    for (let y = top; y < bottom; y += 1) ink[y] = 400;
    const n = i === 0 ? 1 : cols;
    for (let c = 0; c < n; c += 1) boxes.push({ str: `v${i}.${c}`, top, bottom: opts.touch ? top + PITCH : bottom });
  }
  if (opts.rule) for (let y = TOP + PITCH; y < TOP + lines * PITCH; y += 1) ink[y] = ink[y]! + opts.rule;
  return { ink, boxes, spans, height };
}

function expectCover(bands: Band[], height: number) {
  expect(bands[0]!.top).toBe(0);
  expect(bands[bands.length - 1]!.bottom).toBe(height);
  bands.forEach((b, i) => {
    expect(Number.isInteger(b.top) && Number.isInteger(b.bottom)).toBe(true);
    expect(b.bottom).toBeGreaterThan(b.top);
    if (i > 0) expect(b.top).toBe(bands[i - 1]!.bottom);
  });
  // Every pixel row is in exactly one band.
  const hits = new Uint8Array(height);
  for (const b of bands) for (let y = b.top; y < b.bottom; y += 1) hits[y] = hits[y]! + 1;
  expect(hits.every((h) => h === 1)).toBe(true);
}

function expectNoCutThroughInk(bands: Band[], spans: Band[], ink: Uint32Array) {
  const blank = blankRows(ink, WIDTH);
  for (const b of bands.slice(1)) {
    expect(blank[b.top]).toBe(true);
    for (const s of spans) expect(b.top > s.top && b.top < s.bottom).toBe(false);
  }
}

describe("how many bands a page needs", () => {
  test("at or under the row threshold the page is read whole", () => {
    expect(bandCountFor(0)).toBe(0);
    expect(bandCountFor(VISION_PARAMS.bandRowThreshold)).toBe(0);
  });

  test("past it: ceil(lines / bandMaxRows), at least 2, at most maxBandsPerPage", () => {
    const t = VISION_PARAMS.bandRowThreshold;
    const m = VISION_PARAMS.bandMaxRows;
    expect(bandCountFor(t + 1)).toBe(Math.max(2, Math.ceil((t + 1) / m)));
    expect(bandCountFor(m * 3)).toBe(Math.min(VISION_PARAMS.maxBandsPerPage, 3));
    expect(bandCountFor(m * 3 + 1)).toBe(Math.min(VISION_PARAMS.maxBandsPerPage, 4));
    expect(bandCountFor(10_000)).toBe(VISION_PARAMS.maxBandsPerPage);
    expect(scanBandCount(10)).toBe(2);
    expect(scanBandCount(10_000)).toBe(VISION_PARAMS.maxBandsPerPage);
  });
});

describe("text PDF bands", () => {
  test("a page at the threshold is not cut", () => {
    const p = page(VISION_PARAMS.bandRowThreshold);
    expect(planTextBands(p.ink, WIDTH, p.boxes)).toBeNull();
  });

  test("a dense page is cut into the planned count; edges cover every row once; no cut goes through a line", () => {
    for (const lines of [VISION_PARAMS.bandRowThreshold + 1, 150, 200, 260, 320]) {
      const p = page(lines);
      const plan = planTextBands(p.ink, WIDTH, p.boxes)!;
      expect(plan.bands.length).toBe(bandCountFor(lines));
      expectCover(plan.bands, p.height);
      expectNoCutThroughInk(plan.bands, p.spans, p.ink);
      for (const b of plan.bands.slice(0, -1)) {
        const inBand = p.spans.filter((s) => s.top >= b.top && s.bottom <= b.bottom).length;
        if (bandCountFor(lines) * VISION_PARAMS.bandMaxRows >= lines) expect(inBand).toBeLessThanOrEqual(VISION_PARAMS.bandMaxRows + 1);
      }
    }
  });

  test("uneven lines and gaps (seeded): every plan covers each row once and cuts only blank rows", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let run = 0; run < 25; run += 1) {
      const lines = 101 + Math.floor(rand() * 220);
      const spans: Band[] = [];
      const boxes: TextBox[] = [];
      let y = 40 + Math.floor(rand() * 200);
      for (let i = 0; i < lines; i += 1) {
        const h = 12 + Math.floor(rand() * 14);
        spans.push({ top: y, bottom: y + h });
        for (let c = 0; c < (i === 0 ? 1 : 8); c += 1) boxes.push({ str: "x", top: y, bottom: y + h });
        y += h + 4 + Math.floor(rand() * 10);
      }
      const height = y + 80;
      const ink = new Uint32Array(height);
      for (const sp of spans) for (let r = sp.top; r < sp.bottom; r += 1) ink[r] = 150 + Math.floor(rand() * 300);
      const plan = planTextBands(ink, WIDTH, boxes);
      expect(plan).not.toBeNull();
      expect(plan!.bands.length).toBe(bandCountFor(lines));
      expectCover(plan!.bands, height);
      expectNoCutThroughInk(plan!.bands, spans, ink);
    }
  });

  test("a ruled table (vertical rules ink every row) still cuts on its blank gaps", () => {
    const p = page(200, { rule: 36 });
    const plan = planTextBands(p.ink, WIDTH, p.boxes)!;
    expect(plan.bands.length).toBe(bandCountFor(200));
    expectCover(plan.bands, p.height);
    expectNoCutThroughInk(plan.bands, p.spans, p.ink);
  });

  test("tight text boxes that touch the next line: the ink between baselines picks the cut", () => {
    const p = page(180, { touch: true });
    const plan = planTextBands(p.ink, WIDTH, p.boxes)!;
    expectCover(plan.bands, p.height);
    expectNoCutThroughInk(plan.bands, p.spans, p.ink);
  });

  test("a page with no blank row between lines is read whole", () => {
    const p = page(180);
    p.ink.fill(400);
    expect(planTextBands(p.ink, WIDTH, p.boxes)).toBeNull();
  });

  test("the header strip is the header line, drawn from its top to the cut under it", () => {
    const p = page(180);
    const plan = planTextBands(p.ink, WIDTH, p.boxes)!;
    const header = p.spans[1]!;
    expect(plan.strip).not.toBeNull();
    expect(plan.strip!.top).toBeLessThanOrEqual(header.top);
    expect(plan.strip!.bottom).toBeGreaterThanOrEqual(header.bottom);
    expect(plan.strip!.bottom).toBeLessThanOrEqual(p.spans[2]!.top);
    expect(plan.strip!.bottom).toBeLessThanOrEqual(plan.bands[0]!.bottom);
  });
});

describe("scan or photo bands from the ink projection", () => {
  test("lines are runs of ink; bands cover every row once and cut only blank rows", () => {
    const p = page(150, { rule: 30 });
    const blank = blankRows(p.ink, WIDTH);
    expect(inkLines(blank).length).toBe(150);
    const plan = planScanBands(p.ink, WIDTH)!;
    expect(plan.strip).toBeNull();
    expect(plan.bands.length).toBe(scanBandCount(150));
    expectCover(plan.bands, p.height);
    expectNoCutThroughInk(plan.bands, p.spans, p.ink);
  });

  test("a gap shorter than the minimum blank run (a glyph's waist) does not split a line", () => {
    const ink = new Uint32Array(60);
    for (let y = 10; y < 30; y += 1) ink[y] = 300;
    ink[20] = 0;
    ink[21] = 0;
    expect(inkLines(blankRows(ink, WIDTH))).toEqual([{ top: 10, bottom: 30 }]);
  });

  test("cutBands refuses counts it cannot meet", () => {
    const p = page(4);
    const blank = blankRows(p.ink, WIDTH);
    expect(cutBands(blank, p.height, p.spans, 5)).toBeNull();
    expect(cutBands(blank, p.height, p.spans, 1)).toBeNull();
    expectCover(cutBands(blank, p.height, p.spans, 4)!, p.height);
  });
});

describe("the parts read from pixels and the text layer", () => {
  test("inkRows counts dark pixels per row against the paper's luminance", () => {
    const w = 10;
    const h = 4;
    const rgba = new Uint8ClampedArray(w * h * 4).fill(235);
    for (let x = 0; x < 6; x += 1) rgba.set([20, 20, 20, 255], (2 * w + x) * 4);
    expect(Array.from(inkRows(rgba, w, h))).toEqual([0, 0, 6, 0]);
  });

  test("text boxes group into lines by their middles; empty strings are skipped", () => {
    const lines = textLines([
      { str: "A", top: 10, bottom: 20 },
      { str: "B", top: 11, bottom: 21 },
      { str: " ", top: 40, bottom: 50 },
      { str: "C", top: 30, bottom: 40 },
    ]);
    expect(lines).toEqual([{ top: 10, bottom: 21, items: 2 }, { top: 30, bottom: 40, items: 1 }]);
  });

  test("page text is sent whole or not at all", () => {
    expect(pageTextJson([])).toBeNull();
    expect(pageTextJson([" ", ""])).toBeNull();
    expect(JSON.parse(pageTextJson(["R100", " ", "12,500"])!)).toEqual({ v: 1, items: ["R100", "12,500"] });
    const big = Array.from({ length: 20 }, () => "9".repeat(Math.ceil(VISION_PARAMS.maxPageTextBytes / 10)));
    expect(pageTextJson(big)).toBeNull();
  });
});
