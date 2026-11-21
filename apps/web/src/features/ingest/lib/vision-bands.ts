import { VISION_PARAMS } from "@orrn/ingest";

/**
 * Bands for dense pages (contract section 11.3). Pure: no canvas, no pdfjs, so every rule here is unit tested.
 *
 * A page image is cut into horizontal bands, each a run of whole pixel rows: band i covers rows [top, bottom). The
 * edges start at 0, end at the image height, and rise strictly, so every pixel row is in exactly one band and nothing
 * overlaps. A cut row is always blank in the ink projection, so no cut goes through a text line.
 *
 * - Text PDF: the pdfjs text layer gives the lines (mapped through the render viewport to canvas rows). Past
 *   `bandRowThreshold` lines the page is cut into `bandCountFor(lines)` bands. The text layer picks which line boundary
 *   to cut at; the ink projection picks the blank pixel row in that gap (text boxes touch on tight tables).
 * - Scan or photo: no text layer, so the lines are the runs of inked rows of the ink projection.
 *
 * Header strip (text PDF only, bands 2..k): the rule here, since the contract does not define the first body line, is
 * that the header row is the first line with at least `HEADER_ITEMS_SHARE` of the median line's items (a line as wide
 * as the table); the strip runs from that line's top to the cut below it. A strip taller than `HEADER_MAX_SHARE` of the
 * page is not drawn.
 */

/** A pixel row is dark when its luminance is this far under the paper's (median) luminance, 0 to 255. */
export const INK_DARKER_THAN_PAPER = 64;
/** A row is blank when it holds at most this share of the width in ink above the page's floor (vertical rules, noise). */
export const INK_ALLOWANCE = 0.001;
/** The local floor of a row is the least ink within this share of the page height either side of it. */
export const FLOOR_WINDOW = 0.02;
/** The local floor (vertical rules, scan grey) is at most this share of the width; more is ink, not paper. */
export const MAX_FLOOR_SHARE = 0.05;
/** A cut needs a blank run at least this many rows tall, so the thin waist of a glyph is never taken for a gap. */
export const MIN_BLANK_RUN = 3;
/** The header row has at least this share of the median line's items. */
export const HEADER_ITEMS_SHARE = 0.6;
/** A header strip taller than this share of the page is not drawn on bands 2..k. */
export const HEADER_MAX_SHARE = 0.15;
/** When the gap at an even split has no blank run, the boundary may move this many lines either way. */
export const BOUNDARY_SLACK = 3;

export type Band = { top: number; bottom: number };
export type TextLine = { top: number; bottom: number; items: number };
export type TextBox = { str: string; top: number; bottom: number };

/** The bands of a page, or 0 when it is read whole: `ceil(lines / bandMaxRows)`, at least 2, at most `maxBandsPerPage`. */
export function bandCountFor(lines: number): number {
  if (VISION_PARAMS.tiling !== "bands" || lines <= VISION_PARAMS.bandRowThreshold) return 0;
  return Math.min(VISION_PARAMS.maxBandsPerPage, Math.max(2, Math.ceil(lines / VISION_PARAMS.bandMaxRows)));
}

/** The bands a scan or photo is cut into after `next: "band"`: from its ink lines, never fewer than 2. */
export function scanBandCount(lines: number): number {
  return Math.min(VISION_PARAMS.maxBandsPerPage, Math.max(2, Math.ceil(lines / VISION_PARAMS.bandMaxRows)));
}

/**
 * Text boxes (canvas rows, top down) grouped into lines: a box joins the current line when its middle falls inside the
 * line's span. Empty strings are skipped. Lines come back top down, each with its box count.
 */
export function textLines(boxes: readonly TextBox[]): TextLine[] {
  const sorted = boxes
    .filter((b) => b.str.trim() !== "" && Number.isFinite(b.top) && Number.isFinite(b.bottom) && b.bottom > b.top)
    .map((b) => ({ top: b.top, bottom: b.bottom, mid: (b.top + b.bottom) / 2 }))
    .sort((a, b) => a.mid - b.mid);
  const lines: TextLine[] = [];
  for (const box of sorted) {
    const line = lines[lines.length - 1];
    if (line && box.mid >= line.top && box.mid <= line.bottom) {
      line.top = Math.min(line.top, box.top);
      line.bottom = Math.max(line.bottom, box.bottom);
      line.items += 1;
    } else {
      lines.push({ top: box.top, bottom: box.bottom, items: 1 });
    }
  }
  return lines;
}

/** Dark pixels per row of an RGBA image. Dark: luminance `INK_DARKER_THAN_PAPER` under the image's median luminance. */
export function inkRows(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint32Array {
  const hist = new Uint32Array(256);
  const lum = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < lum.length; i += 1, p += 4) {
    const y = (rgba[p]! * 299 + rgba[p + 1]! * 587 + rgba[p + 2]! * 114) / 1000;
    lum[i] = y;
    hist[lum[i]!] = hist[lum[i]!]! + 1;
  }
  let seen = 0;
  let paper = 255;
  for (let v = 0; v < 256; v += 1) {
    seen += hist[v]!;
    if (seen * 2 >= lum.length) {
      paper = v;
      break;
    }
  }
  const dark = paper - INK_DARKER_THAN_PAPER;
  const ink = new Uint32Array(height);
  for (let y = 0; y < height; y += 1) {
    let n = 0;
    for (let x = 0, i = y * width; x < width; x += 1, i += 1) if (lum[i]! < dark) n += 1;
    ink[y] = n;
  }
  return ink;
}

/** Sliding minimum of `ink` over [y - back, y + ahead] for every row (a deque of row indexes, ink rising front to back). */
function slidingMin(ink: Uint32Array, back: number, ahead: number): Uint32Array {
  const n = ink.length;
  const out = new Uint32Array(n);
  const q: number[] = [];
  let head = 0;
  let next = 0;
  for (let y = 0; y < n; y += 1) {
    while (next < n && next <= y + ahead) {
      while (q.length > head && ink[q[q.length - 1]!]! >= ink[next]!) q.pop();
      q.push(next);
      next += 1;
    }
    while (q[head]! < y - back) head += 1;
    out[y] = ink[q[head]!]!;
  }
  return out;
}

/**
 * Which rows are blank: at most the local floor plus the allowance, and the floor itself thin (`MAX_FLOOR_SHARE` of the
 * width, so a solid block never counts as paper). The local floor is the larger of the least ink in the `FLOOR_WINDOW`
 * above the row and the least ink in the window below it: a ruled table (vertical rules ink every row) keeps blank gap
 * rows between its lines even next to the bare margin, and paper noise does not count as text.
 */
export function blankRows(ink: Uint32Array, width: number): boolean[] {
  const n = ink.length;
  if (n === 0) return [];
  const w = Math.max(MIN_BLANK_RUN * 4, Math.round(n * FLOOR_WINDOW));
  const allow = Math.max(1, Math.round(width * INK_ALLOWANCE));
  const thin = width * MAX_FLOOR_SHARE;
  const above = slidingMin(ink, w, 0);
  const below = slidingMin(ink, 0, w);
  return Array.from(ink, (v, y) => {
    const floor = Math.max(above[y]!, below[y]!);
    return floor <= thin && v <= floor + allow;
  });
}

/** Runs of inked rows separated by at least `MIN_BLANK_RUN` blank rows: the lines of a page with no text layer. */
export function inkLines(blank: readonly boolean[]): Band[] {
  const lines: Band[] = [];
  let y = 0;
  while (y < blank.length) {
    while (y < blank.length && blank[y]) y += 1;
    if (y >= blank.length) break;
    const top = y;
    let end = y;
    // A line ends at the first blank run of MIN_BLANK_RUN rows.
    while (end < blank.length) {
      if (!blank[end]) {
        end += 1;
        continue;
      }
      let run = 0;
      while (end + run < blank.length && blank[end + run]) run += 1;
      if (run >= MIN_BLANK_RUN || end + run >= blank.length) break;
      end += run;
    }
    lines.push({ top, bottom: end });
    y = end;
  }
  return lines;
}

/** The middle row of the tallest blank run (at least `MIN_BLANK_RUN` rows) in [from, to), or null. */
function blankCut(blank: readonly boolean[], from: number, to: number): number | null {
  const lo = Math.max(0, Math.floor(from));
  const hi = Math.min(blank.length, Math.ceil(to));
  let best: { top: number; len: number } | null = null;
  let y = lo;
  while (y < hi) {
    if (!blank[y]) {
      y += 1;
      continue;
    }
    const top = y;
    while (y < hi && blank[y]) y += 1;
    const len = y - top;
    if (len >= MIN_BLANK_RUN && (!best || len > best.len)) best = { top, len };
  }
  return best ? best.top + Math.floor(best.len / 2) : null;
}

/** The blank cut between line `a` and line `b` (a above b): in the gap between them, or between their middles. */
function cutBetween(blank: readonly boolean[], a: { top: number; bottom: number }, b: { top: number; bottom: number }): number | null {
  if (b.top > a.bottom) {
    const inGap = blankCut(blank, a.bottom, b.top);
    if (inGap !== null) return inGap;
  }
  return blankCut(blank, (a.top + a.bottom) / 2, (b.top + b.bottom) / 2);
}

/**
 * Cuts a page `height` rows tall into `count` bands at blank rows between `lines` (top down). Each boundary starts at an
 * even split of the lines and may move `BOUNDARY_SLACK` lines either way to find a blank run. Null when it cannot cut
 * `count` bands this way (the page is then read whole).
 */
export function cutBands(blank: readonly boolean[], height: number, lines: readonly { top: number; bottom: number }[], count: number): Band[] | null {
  if (count < 2 || lines.length < count || blank.length !== height) return null;
  const edges = [0];
  let lastLine = 0;
  for (let i = 1; i < count; i += 1) {
    const even = Math.round((i * lines.length) / count);
    let cut: number | null = null;
    for (let d = 0; d <= BOUNDARY_SLACK && cut === null; d += 1) {
      for (const at of d === 0 ? [even] : [even - d, even + d]) {
        // The boundary sits before line `at`: lines [lastLine, at) above it, and at least one line left per later band.
        if (at <= lastLine || at > lines.length - (count - i)) continue;
        const c = cutBetween(blank, lines[at - 1]!, lines[at]!);
        if (c !== null && c > edges[edges.length - 1]! && c < height) {
          cut = c;
          lastLine = at;
          break;
        }
      }
    }
    if (cut === null) return null;
    edges.push(cut);
  }
  edges.push(height);
  return edges.slice(1).map((bottom, i) => ({ top: edges[i]!, bottom }));
}

/** The header strip (rows [top, bottom)) of a text PDF page cut into bands, or null when none fits the rule above. */
export function headerStrip(blank: readonly boolean[], height: number, lines: readonly TextLine[], firstBand: Band): Band | null {
  if (lines.length < 3) return null;
  const counts = lines.map((l) => l.items).sort((a, b) => a - b);
  const median = counts[Math.floor(counts.length / 2)]!;
  const at = lines.findIndex((l) => l.items >= Math.max(2, median * HEADER_ITEMS_SHARE));
  if (at < 0 || at + 1 >= lines.length) return null;
  const header = lines[at]!;
  const below = cutBetween(blank, header, lines[at + 1]!);
  if (below === null || below > firstBand.bottom) return null;
  const top = Math.max(0, Math.floor(header.top) - MIN_BLANK_RUN);
  if (below <= top || below - top > height * HEADER_MAX_SHARE) return null;
  return { top, bottom: below };
}

export type BandPlan = { bands: Band[]; strip: Band | null };

/** Text PDF: bands from the text-layer lines, or null when the page is read whole (or cannot be cut on blank rows). */
export function planTextBands(ink: Uint32Array, width: number, boxes: readonly TextBox[]): BandPlan | null {
  const lines = textLines(boxes);
  const count = bandCountFor(lines.length);
  if (count === 0) return null;
  const blank = blankRows(ink, width);
  const bands = cutBands(blank, ink.length, lines, count);
  if (!bands) return null;
  return { bands, strip: headerStrip(blank, ink.length, lines, bands[0]!) };
}

/** Scan or photo after `next: "band"`: bands from the ink lines, no header strip (the server sends the headers as text). */
export function planScanBands(ink: Uint32Array, width: number): BandPlan | null {
  const blank = blankRows(ink, width);
  const lines = inkLines(blank);
  const bands = cutBands(blank, ink.length, lines, scanBandCount(lines.length));
  return bands ? { bands, strip: null } : null;
}

/**
 * The page text a text PDF sends for the digit check (section 11.5), as UTF-8 JSON `{ v: 1, items }`. Null when the page
 * has no text or the JSON is over `maxPageTextBytes`: partial text would mark right cells, and missing text marks none.
 */
export function pageTextJson(items: readonly string[]): string | null {
  const kept = items.filter((s) => s.trim() !== "");
  if (kept.length === 0) return null;
  const json = JSON.stringify({ v: 1, items: kept });
  return new TextEncoder().encode(json).length <= VISION_PARAMS.maxPageTextBytes ? json : null;
}
