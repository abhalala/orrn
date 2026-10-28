import { type LabelDocument, type LabelElement, type LabelPage, type LabelVariable } from "@orrn/domain";

import { barPattern, dots, elementBounds, elementShape, mmFromDots, qrMatrix, round2, type LabelValues } from "./label-metrics";

/**
 * Turns what the browser read off a photo of a label (codes and OCR text lines, in pixels of the
 * straightened photo) into an editable ORRN label document laid out like it. Pure, so
 * `label-photo-import.test.ts` drives it with synthetic detections.
 *
 * Printed geometry follows `label-metrics.ts`: text is TSPL font "3" in whole 3 mm steps, a QR is
 * modules × whole-dot cells, a Code 128 module is `narrow` dots. Captions people print on bundle
 * labels ("Quantity", "Cut length", "PO", …) bind the value next to or under them to the matching
 * frozen label variable; values that look like a known field bind by pattern; the rest stays fixed
 * text.
 */

export type PixelBox = { x: number; y: number; width: number; height: number };
export type DetectedCode = { format: string; value: string; box: PixelBox };
export type DetectedWord = { text: string; confidence: number; box: PixelBox };
export type DetectedLine = { text: string; confidence: number; box: PixelBox; words: DetectedWord[] };
/** Everything read off the straightened photo, which is `width` × `height` pixels. */
export type PhotoDetections = { width: number; height: number; codes: DetectedCode[]; lines: DetectedLine[] };

export type ImportItem = {
  id: string;
  kind: "text" | "qrcode" | "barcode";
  /** What the item is on the label: a caption printed before a value, a value, other text, or a code. */
  role: "caption" | "value" | "text" | "code";
  /** Cleaned text as read (codes: their value). Fixed text prints this. */
  text: string;
  /** Field the element prints; null prints `text` as fixed text. */
  binding: LabelVariable | null;
  included: boolean;
  /** 0 to 100. */
  confidence: number;
  /** Where it was read, in pixels of the straightened photo. */
  photoBox: PixelBox;
  /** Placed element without its source (`content` / `variable`), which `binding` decides. */
  element: LabelElement;
};

/** OCR lines below this mean confidence are noise (dirt, a fold, the edge of the roll). */
export const MIN_LINE_CONFIDENCE = 45;
/** Words below this confidence are dropped from a line. */
const MIN_WORD_CONFIDENCE = 25;
export const MAX_TEXT_LENGTH = 120;
const MAX_ELEMENTS = 64;
/** Font 3 glyph ink height as a share of its cell: caps and digits only, and with descenders. */
const INK_SHARE = 0.68;
const INK_SHARE_DESCENDERS = 0.86;
/** Cap top below the top of the font cell, as a share of the cell. */
const CAP_OFFSET = 0.16;
const MIN_QR_CELL_DOTS = 3;
const QUIET_ZONE_MM = 2;
const MIN_BARCODE_HEIGHT_MM = 5;

/** ZXing / BarcodeDetector formats the TE200 can print, as label symbologies. */
export const PHOTO_SYMBOLOGIES: Record<string, string> = {
  code_128: "128",
  code_39: "39",
  code_93: "93",
  codabar: "CODABAR",
  ean_13: "EAN13",
  ean_8: "EAN8",
  itf: "I2OF5",
  upc_a: "UPCA",
  upc_e: "UPCE",
};

/** Formats the photo reader looks for: the bundle QR and every printable linear code. */
export const PHOTO_CODE_FORMATS = ["qr_code", ...Object.keys(PHOTO_SYMBOLOGIES)];

/**
 * Printed captions, matched on the whole caption after case folding and trimming a trailing colon.
 * Order matters: the more specific weights come before plain "weight".
 */
const CAPTIONS: Array<[LabelVariable, RegExp]> = [
  ["weight12ft", /^(weight|wt)\.?\s*(\/|per)?\s*12\s*('|ft|feet)\.?$|^12\s*(ft|feet)\s*(weight|wt)\.?$/],
  ["weight_each", /^(weight|wt)\.?\s*(\/|per)?\s*(cut|each|pc|pcs|piece)\.?$|^(each|unit|cut)\s*(weight|wt)\.?$|^weight\s*each$/],
  ["weight", /^(total|net|gross)\s*(weight|wt)\.?$|^(weight|wt)\.?$/],
  ["quantity", /^(qty|quantity|pcs|pieces|nos|no\.?\s*of\s*(pcs|pieces))\.?$/],
  ["length", /^(cut\s*)?(length|len)\.?$/],
  ["poNumber", /^(p\.?\s*o\.?(\s*(no|number|#)\.?)?|purchase\s*order(\s*no\.?)?)$/],
  ["salesOrder", /^(sales\s*order(\s*no\.?)?|s\.?\s*o\.?(\s*(no|number|#)\.?)?)$/],
  ["seriesName", /^(series|section|profile|series\s*name)$/],
  ["cast", /^(cast|cast\s*(no|number)\.?|heat\s*(no|number)\.?)$/],
  ["standard", /^(bis|is|standard|bis\s*standard|is\s*no\.?)$/],
  ["cml", /^(cml|cml\s*(no|number)\.?)$/],
  ["partyNo", /^(party|party\s*(bundle|no|number)\.?|party\s*bundle\s*(no|number)\.?)$/],
  ["serialNumber", /^(bundle|bundle\s*(no|number)\.?|serial|serial\s*(no|number)\.?|sr\.?\s*no\.?)$/],
];

/** Value patterns for text with no caption, checked in order. */
const VALUE_PATTERNS: Array<[LabelVariable, RegExp]> = [
  ["weight12ft", /^\d+(\.\d+)?\s*kg\s*\/\s*12\s*(ft|')$/i],
  ["weight", /^\d+(\.\d+)?\s*kgs?$/i],
  ["quantity", /^\d+\s*(pcs|pc|nos|pieces)$/i],
  ["length", /^\d+(\.\d+)?\s*(ft|feet|mm)$/i],
  ["standard", /^IS\s*:?\s*\d{2,5}\b/i],
  ["cml", /^CML[\s:-]*\d{4,}/i],
  ["poNumber", /^PO[\s:-]*\d[\w/-]*$/i],
  ["salesOrder", /^SO[\s:-]*\d[\w/-]*$/i],
];

/** ORRN bundle numbers: `26J9094` (year, month letter, sequence), `J540`, and `BG-…` serials. */
const SERIAL = /^(\d{2})?[A-L]\d{3,6}$|^BG-[A-Z0-9-]{4,}$/i;

export function captionVariable(text: string): LabelVariable | null {
  const caption = text
    .toLowerCase()
    .replace(/[:;.,\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!caption || caption.length > 32) return null;
  for (const [variable, pattern] of CAPTIONS) if (pattern.test(caption)) return variable;
  return null;
}

/** The bundle number a scanned QR carries: `…/b/{number}?c=…`, or a bare number. */
export function serialFromQr(value: string): string | null {
  const path = /\/b\/([^/?#\s]+)/.exec(value)?.[1];
  if (path) {
    try {
      return decodeURIComponent(path);
    } catch {
      return path;
    }
  }
  return SERIAL.test(value.trim()) ? value.trim() : null;
}

const sameText = (a: string, b: string) => a.replace(/\s+/g, "").toLowerCase() === b.replace(/\s+/g, "").toLowerCase();

export function valueVariable(text: string, serial: string | null): LabelVariable | null {
  const value = text.trim();
  if (serial && sameText(value, serial)) return "serialNumber";
  for (const [variable, pattern] of VALUE_PATTERNS) if (pattern.test(value)) return variable;
  if (SERIAL.test(value)) return "serialNumber";
  return null;
}

/** Printable text: control characters and stray rule glyphs removed, spaces collapsed, at most 120 characters. */
export function cleanText(text: string): string {
  return text
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/[|¦_~`]+/g, " ")
    .replace(/[\u2014\u2013]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-=.,;'"]+\s*|\s*[-=,;'"]+$/g, "")
    .slice(0, MAX_TEXT_LENGTH)
    .trim();
}

const alnumCount = (text: string) => (text.match(/[\p{L}\p{N}]/gu) ?? []).length;

function union(boxes: readonly PixelBox[]): PixelBox {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function overlapArea(a: PixelBox, b: PixelBox): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/** A run of words on one line that reads as one piece of text (columns split at wide gaps). */
type Segment = { text: string; confidence: number; box: PixelBox; words: DetectedWord[] };

/** Splits a line where the gap between words is wider than about two characters (columns). */
function segmentsOf(line: DetectedLine): Segment[] {
  const words = line.words
    .map((word) => ({ ...word, text: cleanText(word.text) }))
    .filter((word) => word.text && word.confidence >= MIN_WORD_CONFIDENCE)
    .sort((a, b) => a.box.x - b.box.x);
  if (words.length === 0) {
    const text = cleanText(line.text);
    return text ? [{ text, confidence: line.confidence, box: line.box, words: [] }] : [];
  }
  const height = Math.max(...words.map((word) => word.box.height));
  const groups: DetectedWord[][] = [[words[0]!]];
  for (const word of words.slice(1)) {
    const group = groups.at(-1)!;
    const previous = group.at(-1)!;
    const gap = word.box.x - (previous.box.x + previous.box.width);
    if (gap > height * 1.8) groups.push([word]);
    else group.push(word);
  }
  return groups.map((group) => ({
    text: cleanText(group.map((word) => word.text).join(" ")),
    confidence: group.reduce((sum, word) => sum + word.confidence, 0) / group.length,
    box: union(group.map((word) => word.box)),
    words: group,
  }));
}

type Piece = Segment & { caption: LabelVariable | null };

/** Box of the characters `from`..`to` of a single word, assuming even character widths. */
function charBox(word: DetectedWord, from: number, to: number): PixelBox {
  const share = word.box.width / Math.max(1, word.text.length);
  return { x: word.box.x + share * from, y: word.box.y, width: share * (to - from), height: word.box.height };
}

/** "Caption: value" and "Qty 24" split into a caption piece and a value piece. */
function splitCaption(segment: Segment): Piece[] {
  const whole = captionVariable(segment.text);
  if (whole) return [{ ...segment, caption: whole }];
  // A whole value ("IS 733", "PO-2471") is not a caption followed by a number.
  if (VALUE_PATTERNS.some(([, pattern]) => pattern.test(segment.text))) return [{ ...segment, caption: null }];
  const { words } = segment;
  // Colon split, inside a word ("Qty:24") or after one ("Qty: 24").
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    const colon = word.text.indexOf(":");
    if (colon < 0) continue;
    const captionWords = words.slice(0, index);
    const captionText = cleanText([...captionWords.map((w) => w.text), word.text.slice(0, colon)].join(" "));
    const variable = captionVariable(captionText);
    if (!variable) break;
    const rest = word.text.slice(colon + 1);
    const valueWords = words.slice(index + 1);
    const valueText = cleanText([rest, ...valueWords.map((w) => w.text)].join(" "));
    const captionBoxes = [...captionWords.map((w) => w.box), charBox(word, 0, colon + 1)];
    const caption: Piece = { text: `${captionText}:`, confidence: segment.confidence, box: union(captionBoxes), words: captionWords, caption: variable };
    if (!valueText) return [caption];
    const valueBoxes = [...(rest ? [charBox(word, colon + 1, word.text.length)] : []), ...valueWords.map((w) => w.box)];
    return [caption, { text: valueText, confidence: segment.confidence, box: union(valueBoxes), words: valueWords, caption: null }];
  }
  // Caption words then a value with a digit: "Qty 24", "Cut length 13.66 ft".
  for (let take = Math.min(3, words.length - 1); take >= 1; take -= 1) {
    const captionWords = words.slice(0, take);
    const variable = captionVariable(captionWords.map((w) => w.text).join(" "));
    if (!variable) continue;
    const valueWords = words.slice(take);
    const valueText = cleanText(valueWords.map((w) => w.text).join(" "));
    if (!/\d/.test(valueText)) break;
    return [
      { text: cleanText(captionWords.map((w) => w.text).join(" ")), confidence: segment.confidence, box: union(captionWords.map((w) => w.box)), words: captionWords, caption: variable },
      { text: valueText, confidence: segment.confidence, box: union(valueWords.map((w) => w.box)), words: valueWords, caption: null },
    ];
  }
  return [{ ...segment, caption: null }];
}

/** The value a caption labels: the nearest piece under it (left-aligned or overlapping) or to its right. */
function findValue(caption: Piece, pieces: readonly Piece[], taken: ReadonlySet<Piece>): Piece | null {
  const h = caption.box.height;
  const right = caption.box.x + caption.box.width;
  const bottom = caption.box.y + caption.box.height;
  let best: { piece: Piece; score: number } | null = null;
  for (const piece of pieces) {
    if (piece === caption || piece.caption || taken.has(piece)) continue;
    const { box } = piece;
    const centreGap = Math.abs(box.y + box.height / 2 - (caption.box.y + h / 2));
    const horizontalOverlap = Math.min(right, box.x + box.width) - Math.max(caption.box.x, box.x);
    let score = Infinity;
    // Beside it on the same row.
    if (centreGap < Math.max(h, box.height) * 0.6 && box.x >= right - h * 0.5) {
      const gap = box.x - right;
      if (gap <= h * 12) score = gap / h;
    }
    // Under it: left edges line up or the boxes overlap across.
    const below = box.y - bottom;
    if (below >= -h * 0.3 && below <= h * 2.2 && (Math.abs(box.x - caption.box.x) <= h * 2 || horizontalOverlap > Math.min(box.width, caption.box.width) * 0.5)) {
      score = Math.min(score, Math.max(0, below) / h + Math.abs(box.x - caption.box.x) / (h * 4));
    }
    if (score < (best?.score ?? Infinity)) best = { piece, score };
  }
  return best?.piece ?? null;
}

function fontSizeFor(piece: Piece, mmPerPx: number): number {
  const inkMm = piece.box.height * mmPerPx;
  const share = /[gjpqy,;()[\]{}/|]/.test(piece.text) ? INK_SHARE_DESCENDERS : INK_SHARE;
  const scale = Math.max(1, Math.round(inkMm / share / 3));
  return Math.min(48, scale * 3);
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
  used.add(id);
  return id;
}

/**
 * Reads the detections into review items, one per element the import would create, top to
 * bottom. Codes come first in importance; at most 64 items are included (the printer's limit).
 */
export function analyzePhoto(detections: PhotoDetections, page: Pick<LabelPage, "widthMm" | "heightMm">): ImportItem[] {
  const sx = page.widthMm / detections.width;
  const sy = page.heightMm / detections.height;
  const mmPerPx = (sx + sy) / 2;
  const toMm = (box: PixelBox) => ({ x: box.x * sx, y: box.y * sy, width: box.width * sx, height: box.height * sy });
  const used = new Set<string>();
  const items: ImportItem[] = [];

  const qrValues = detections.codes.filter((code) => code.format === "qr_code").map((code) => code.value);
  const serial = qrValues.map(serialFromQr).find((value): value is string => value !== null) ?? null;

  // Lines that are really a code (QR modules read as letters) or its printed value are not text.
  const codeBoxes = detections.codes.map((code) => code.box);
  const consumed = new Set<DetectedLine>();

  for (const code of detections.codes) {
    const box = toMm(code.box);
    if (code.format === "qr_code") {
      // Module count at the level the studio prints (M) gives the module pitch.
      const modules = qrMatrix(code.value, "M")?.size ?? 25;
      const pitchMm = (box.width + box.height) / 2 / modules;
      const cellDots = Math.max(MIN_QR_CELL_DOTS, Math.round((pitchMm * 203) / 25.4));
      items.push({
        id: uniqueId("qr", used),
        kind: "qrcode",
        role: "code",
        text: code.value,
        binding: "qr",
        included: true,
        confidence: 100,
        photoBox: code.box,
        element: { id: "", type: "qrcode", xMm: round2(box.x), yMm: round2(box.y), rotation: 0, level: "M", model: 2, mask: "auto", mode: "auto", cellMm: round2(mmFromDots(cellDots)), quietZoneMm: QUIET_ZONE_MM },
      });
      continue;
    }
    const symbology = PHOTO_SYMBOLOGIES[code.format];
    if (!symbology) continue;
    const modules = barPattern(symbology, code.value)?.length ?? 0;
    const narrow = modules ? Math.min(10, Math.max(1, Math.round((box.width / modules) * (203 / 25.4)))) : 2;
    // Its human-readable value printed under the bars.
    const readable = detections.lines.find((line) => {
      const gap = line.box.y - (code.box.y + code.box.height);
      const overlap = Math.min(line.box.x + line.box.width, code.box.x + code.box.width) - Math.max(line.box.x, code.box.x);
      return gap > -line.box.height * 0.5 && gap < line.box.height * 1.5 && overlap > line.box.width * 0.5 && sameText(cleanText(line.text), code.value);
    });
    if (readable) consumed.add(readable);
    const isSerial = (serial !== null && sameText(code.value, serial)) || SERIAL.test(code.value.trim());
    items.push({
      id: uniqueId(isSerial ? "serial-barcode" : "barcode", used),
      kind: "barcode",
      role: "code",
      text: code.value,
      binding: isSerial ? "serialNumber" : null,
      included: true,
      confidence: 100,
      photoBox: code.box,
      element: {
        id: "",
        type: "barcode",
        xMm: round2(box.x),
        yMm: round2(box.y),
        rotation: 0,
        symbology,
        heightMm: round2(Math.max(MIN_BARCODE_HEIGHT_MM, box.height)),
        narrow,
        wide: symbology === "128" ? narrow : Math.min(10, narrow * 2),
        humanReadable: Boolean(readable),
        quietZoneMm: QUIET_ZONE_MM,
      },
    });
  }

  const pieces: Piece[] = [];
  for (const line of detections.lines) {
    if (consumed.has(line) || line.confidence < MIN_LINE_CONFIDENCE) continue;
    for (const segment of segmentsOf(line)) {
      const area = segment.box.width * segment.box.height;
      if (codeBoxes.some((box) => overlapArea(box, segment.box) > area * 0.3)) continue;
      const letters = alnumCount(segment.text);
      if (segment.confidence < MIN_LINE_CONFIDENCE || letters === 0 || (letters < 2 && segment.confidence < 80)) continue;
      pieces.push(...splitCaption(segment));
    }
  }

  const values = new Map<Piece, LabelVariable>();
  const taken = new Set<Piece>();
  for (const piece of pieces) {
    if (!piece.caption) continue;
    const value = findValue(piece, pieces, taken);
    if (!value) continue;
    taken.add(value);
    values.set(value, piece.caption);
  }

  const textItems: ImportItem[] = pieces.map((piece) => {
    const box = toMm(piece.box);
    const fontSizeMm = fontSizeFor(piece, mmPerPx);
    const element: LabelElement = {
      id: "",
      type: "text",
      xMm: round2(Math.max(0, box.x)),
      yMm: round2(Math.max(0, box.y - CAP_OFFSET * fontSizeMm)),
      rotation: 0,
      font: "Sans Serif",
      fontSizeMm,
      align: "left",
    };
    const captioned = values.get(piece);
    const binding = piece.caption ? null : (captioned ?? valueVariable(piece.text, serial));
    const role: ImportItem["role"] = piece.caption ? "caption" : binding ? "value" : "text";
    const base = piece.caption ? `${piece.caption}-label` : (binding ?? "text");
    return { id: base, kind: "text", role, text: piece.text, binding, included: true, confidence: Math.round(piece.confidence), photoBox: piece.box, element };
  });

  const ordered = [...items, ...textItems.sort((a, b) => Math.round(a.element.yMm) - Math.round(b.element.yMm) || a.element.xMm - b.element.xMm)];
  for (const item of ordered.slice(items.length)) item.id = uniqueId(item.id, used);
  ordered.forEach((item, index) => {
    item.element.id = item.id;
    if (index >= MAX_ELEMENTS) item.included = false;
  });
  return ordered;
}

/** The element an item prints with its current binding. */
function elementOf(item: ImportItem): LabelElement {
  const element: LabelElement = structuredClone(item.element);
  delete element.content;
  delete element.variable;
  if (item.binding) element.variable = item.binding;
  else element.content = cleanText(item.text) || "Text";
  return element;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/** Moves and, where it has to, shrinks an element until it prints inside the label with these values. */
function fit(element: LabelElement, page: Pick<LabelPage, "widthMm" | "heightMm">, values: LabelValues): LabelElement {
  const next = { ...element };
  const { widthMm, heightMm } = page;
  const size = () => elementShape(next, values);
  if (next.type === "text") {
    while ((next.fontSizeMm ?? 3) > 3 && (size().widthMm > widthMm || size().heightMm > heightMm)) next.fontSizeMm = (next.fontSizeMm ?? 3) - 3;
  }
  if (next.type === "qrcode") {
    let cellDots = dots(next.cellMm ?? 0.75);
    while (cellDots > MIN_QR_CELL_DOTS && size().widthMm > Math.min(widthMm, heightMm) - QUIET_ZONE_MM * 2) {
      cellDots -= 1;
      next.cellMm = round2(mmFromDots(cellDots));
    }
  }
  if (next.type === "barcode") {
    while ((next.narrow ?? 2) > 1 && size().widthMm > widthMm - QUIET_ZONE_MM * 2) {
      next.narrow = (next.narrow ?? 2) - 1;
      next.wide = Math.max(next.narrow, Math.min(next.wide ?? next.narrow, next.narrow * 2));
    }
    next.heightMm = round2(clamp(next.heightMm ?? 10, MIN_BARCODE_HEIGHT_MM, heightMm - QUIET_ZONE_MM * 2 - (next.humanReadable ? 3 : 0)));
  }
  const shape = size();
  const margin = next.type === "qrcode" || next.type === "barcode" ? QUIET_ZONE_MM : 0;
  next.xMm = round2(clamp(next.xMm, margin, widthMm - shape.widthMm - margin));
  next.yMm = round2(clamp(next.yMm, margin, heightMm - shape.heightMm - margin));
  if (next.type === "qrcode") {
    // The box the studio shows; the printed side is modules × cell.
    const side = round2(Math.min(shape.widthMm, widthMm - next.xMm, heightMm - next.yMm));
    next.widthMm = side;
    next.heightMm = side;
  }
  // Rounding must not push the box past the edge.
  const bounds = elementBounds(next, elementShape(next, values));
  if (bounds.x + bounds.width > widthMm) next.xMm = round2(Math.max(0, next.xMm - (bounds.x + bounds.width - widthMm) - 0.01));
  if (bounds.y + bounds.height > heightMm) next.yMm = round2(Math.max(0, next.yMm - (bounds.y + bounds.height - heightMm) - 0.01));
  return next;
}

/**
 * The label document for the included items, each fitted inside `page` with `values` (the
 * sample bundle the review shows). Valid for the TE200 whenever at least one item is included.
 */
export function buildLabelDocument(items: readonly ImportItem[], page: LabelPage, values: LabelValues): LabelDocument {
  const elements = items
    .filter((item) => item.included)
    .slice(0, MAX_ELEMENTS)
    .map((item) => fit(elementOf(item), page, values));
  return { version: 1, page: { ...page }, elements };
}

/** A fresh label page of this stock with the studio's defaults. */
export function photoPage(widthMm: number, heightMm: number): LabelPage {
  return { widthMm: round2(widthMm), heightMm: round2(heightMm), gapMm: 2, dpi: 203, speedInSec: 5, density: 8, direction: 0 };
}
