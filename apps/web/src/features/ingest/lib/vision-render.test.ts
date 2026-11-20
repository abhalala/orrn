import { describe, expect, test } from "bun:test";
import { VISION_PARAMS } from "@orrn/ingest";

import { capLine, isVisualKind, pageNumbers, pdfCanvasSize, photoCanvasSize, plannedPages } from "./vision-render";

const LONG = VISION_PARAMS.longSidePx;
const MAX = VISION_PARAMS.maxPagesPerFile;

describe("page images: sizing", () => {
  test("an A4 page (595 x 842 pt) renders with its long side at the parameter, the short side in proportion", () => {
    const size = pdfCanvasSize(595, 842);
    expect(size.height).toBe(LONG);
    expect(size.width).toBe(Math.round(595 * (LONG / 842)));
    expect(size.scale).toBeCloseTo(LONG / 842, 10);
  });

  test("a landscape page fits on its width", () => {
    const size = pdfCanvasSize(842, 595);
    expect(size.width).toBe(LONG);
    expect(size.height).toBe(Math.round(595 * (LONG / 842)));
  });

  test("a small PDF page is scaled up to the long side, so small print stays readable", () => {
    const size = pdfCanvasSize(200, 100);
    expect(size.width).toBe(LONG);
    expect(size.height).toBe(LONG / 2);
  });

  test("a large photo is scaled down to the long side", () => {
    expect(photoCanvasSize(4000, 3000)).toEqual({ width: LONG, height: Math.round(3000 * (LONG / 4000)) });
    expect(photoCanvasSize(3000, 4000)).toEqual({ width: Math.round(3000 * (LONG / 4000)), height: LONG });
  });

  test("a small photo is never scaled up", () => {
    expect(photoCanvasSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  test("a sliver never ends at zero pixels", () => {
    expect(photoCanvasSize(10_000, 1).height).toBe(1);
    expect(pdfCanvasSize(10_000, 1).height).toBe(1);
  });
});

describe("page images: the page cap", () => {
  test("pages 1 to the cap are read, never more", () => {
    expect(plannedPages(1)).toBe(1);
    expect(plannedPages(MAX)).toBe(MAX);
    expect(plannedPages(MAX + 15)).toBe(MAX);
    expect(pageNumbers(3)).toEqual([1, 2, 3]);
    expect(pageNumbers(MAX + 1)).toHaveLength(MAX);
    expect(pageNumbers(MAX + 1).at(-1)).toBe(MAX);
  });

  test("the cap line names the pages read and the file's own count, and only past the cap", () => {
    expect(capLine(MAX)).toBeNull();
    expect(capLine(2)).toBeNull();
    expect(capLine(MAX + 15)).toEqual({ key: "ingest.vision.cap", vars: { max: MAX, total: MAX + 15 } });
  });

  test("PDFs and photos are visual kinds; sheets are not", () => {
    expect(isVisualKind("pdf_text")).toBe(true);
    expect(isVisualKind("pdf_scan")).toBe(true);
    expect(isVisualKind("image")).toBe(true);
    expect(isVisualKind("sheet")).toBe(false);
    expect(isVisualKind(null)).toBe(false);
  });
});
