import { LABEL_VARIABLES, type LabelDocument, type LabelElement, type LabelVariable } from "@orrn/domain";
import barcodesModule from "jsbarcode/bin/barcodes";
import QRCode from "qrcode";

// The CommonJS build exports `{ default: encoders }`; Vite's interop hands back the whole module.
const barcodes: typeof barcodesModule =
  "default" in barcodesModule && typeof barcodesModule.default === "object" ? (barcodesModule.default as unknown as typeof barcodesModule) : barcodesModule;

/**
 * Printed geometry of a label document, mirroring orrn-spool's `RenderLabelDocument`: millimetres
 * round to 203 dpi dots, every text element prints in TSPL font "3" (a 16 × 24 dot cell) at a whole
 * multiple of `fontSizeMm / 3`, alignment is not sent, a QR is modules × cell dots without a quiet
 * zone, and a Code 128 bar module is `narrow` dots. The studio preview and its checks read this,
 * so what the screen shows is what the TA220 prints.
 */
export const DPI = 203;
const FONT_CELL = { width: 16, height: 24 } as const;
const HUMAN_READABLE_MM = 3;

export const dots = (mm: number) => Math.round((mm * DPI) / 25.4);
export const mmFromDots = (value: number) => (value * 25.4) / DPI;
export const round2 = (value: number) => Math.round(value * 100) / 100;

/** Common TA220 roll sizes; the first is the plant's current bundle label. */
export const STOCK_SIZES = [
  { label: "102.25 × 76.2 mm (4 × 3 in)", widthMm: 102.25, heightMm: 76.2 },
  { label: "100 × 75 mm", widthMm: 100, heightMm: 75 },
  { label: "100 × 50 mm", widthMm: 100, heightMm: 50 },
  { label: "101.6 × 152.4 mm (4 × 6 in)", widthMm: 101.6, heightMm: 152.4 },
  { label: "76.2 × 50.8 mm (3 × 2 in)", widthMm: 76.2, heightMm: 50.8 },
  { label: "50 × 25 mm", widthMm: 50, heightMm: 25 },
  { label: "38 × 25 mm", widthMm: 38, heightMm: 25 },
] as const;

/** Same rounding as the agent's `fontScale`. */
export function fontScale(sizeMm: number | undefined): number {
  return Math.max(1, Math.floor((sizeMm ?? 3) / 3 + 0.5));
}

export type LabelValues = Partial<Record<LabelVariable, string>>;

/** Shown until a real bundle is loaded; shaped like `buildBundleLabelVariables` output. */
export const SAMPLE_BUNDLE: Record<LabelVariable, string> = {
  serialNumber: "26J9094",
  qr: "https://plant.orrn.in/b/26J9094?c=plant",
  quantity: "24",
  length: "13.66 ft",
  poNumber: "PO-2471",
  seriesName: '(3/4)" 2 Track Top',
  weight: "48.7 kg",
  weight12ft: "1.78 kg/12ft",
  weight_each: "2.029",
  layout: "x0",
  cast: "K31",
  salesOrder: "SO-12/1",
  standard: "IS 733",
  cml: "CML-4100231",
  partyNo: "26J9094",
  showLogo: "1",
};

export const VARIABLE_LABELS: Record<LabelVariable, string> = {
  serialNumber: "Bundle number",
  qr: "QR address",
  quantity: "Pieces",
  length: "Cut length",
  poNumber: "PO number",
  seriesName: "Series",
  weight: "Total weight",
  weight12ft: "Weight per 12 ft",
  weight_each: "Weight per cut",
  layout: "Layout",
  cast: "Cast",
  salesOrder: "Sales order",
  standard: "BIS standard",
  cml: "CML number",
  partyNo: "Party bundle number",
  showLogo: "Logo flag",
};

export const FIELD_CATALOG = LABEL_VARIABLES.filter((variable) => variable !== "showLogo" && variable !== "layout");

/** Variable wins over content; `{{name}}` placeholders fill from the same values (agent `renderLabelContent`). */
export function resolveContent(element: LabelElement, values: LabelValues): string {
  if (element.variable) return values[element.variable] ?? "";
  return (element.content ?? "").replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name as LabelVariable] ?? "");
}

export type QrMatrix = { size: number; dark: (row: number, column: number) => boolean };

export function qrMatrix(content: string, level: LabelElement["level"]): QrMatrix | null {
  if (!content) return null;
  try {
    const { modules } = QRCode.create(content, { errorCorrectionLevel: level ?? "M" });
    return { size: modules.size, dark: (row, column) => modules.get(row, column) === 1 };
  } catch {
    return null;
  }
}

const ENCODERS: Record<string, string> = {
  "128": "CODE128",
  "39": "CODE39",
  "93": "CODE93",
  CODABAR: "codabar",
  EAN13: "EAN13",
  EAN8: "EAN8",
  I2OF5: "ITF",
  MSI: "MSI",
  UPCA: "UPC",
  UPCE: "UPCE",
};

/** Bar pattern ("1" = bar module), or null when the symbology cannot encode the value. */
export function barPattern(symbology: string | undefined, content: string): string | null {
  const encoder = barcodes[ENCODERS[symbology ?? ""] ?? ""];
  if (!encoder || !content) return null;
  try {
    const instance = new encoder(content, {});
    if (!instance.valid()) return null;
    const encoded = instance.encode();
    return Array.isArray(encoded) ? encoded.map((part) => part.data).join("") : encoded.data;
  } catch {
    return null;
  }
}

export type ElementShape =
  | { kind: "text"; text: string; scale: number; widthMm: number; heightMm: number; charWidthMm: number }
  | { kind: "qrcode"; matrix: QrMatrix | null; cellMm: number; widthMm: number; heightMm: number }
  | { kind: "barcode"; pattern: string | null; text: string; moduleMm: number; barHeightMm: number; readable: boolean; widthMm: number; heightMm: number }
  | { kind: "line" | "box"; strokeMm: number; widthMm: number; heightMm: number }
  | { kind: "symbol"; widthMm: number; heightMm: number };

/** Unrotated printed size and drawing data of one element at the given values. */
export function elementShape(element: LabelElement, values: LabelValues): ElementShape {
  const content = resolveContent(element, values);
  switch (element.type) {
    case "text": {
      const scale = fontScale(element.fontSizeMm);
      const charWidthMm = mmFromDots(FONT_CELL.width * scale);
      return { kind: "text", text: content, scale, charWidthMm, widthMm: Math.max(content.length, 1) * charWidthMm, heightMm: mmFromDots(FONT_CELL.height * scale) };
    }
    case "qrcode": {
      const matrix = qrMatrix(content, element.level);
      const cellMm = mmFromDots(dots(element.cellMm ?? 1));
      const side = matrix ? matrix.size * cellMm : element.widthMm ?? 20;
      return { kind: "qrcode", matrix, cellMm, widthMm: side, heightMm: side };
    }
    case "barcode": {
      const pattern = barPattern(element.symbology, content);
      const moduleMm = mmFromDots(element.narrow ?? 2);
      const barHeightMm = mmFromDots(dots(element.heightMm ?? 10));
      const readable = element.humanReadable ?? false;
      const widthMm = pattern ? pattern.length * moduleMm : element.widthMm ?? 30;
      return { kind: "barcode", pattern, text: content, moduleMm, barHeightMm, readable, widthMm, heightMm: barHeightMm + (readable ? HUMAN_READABLE_MM : 0) };
    }
    case "line":
    case "box":
      return { kind: element.type, strokeMm: element.strokeMm ?? 0.25, widthMm: element.widthMm ?? 10, heightMm: element.heightMm ?? element.strokeMm ?? 0.25 };
    default:
      return { kind: "symbol", widthMm: element.widthMm ?? 12, heightMm: element.heightMm ?? 12 };
  }
}

export type Rect = { x: number; y: number; width: number; height: number };

/** Page-space box after the clockwise TSPL rotation about the element's origin. */
export function elementBounds(element: LabelElement, shape: Pick<ElementShape, "widthMm" | "heightMm">): Rect {
  const { widthMm: w, heightMm: h } = shape;
  const x = mmFromDots(dots(element.xMm));
  const y = mmFromDots(dots(element.yMm));
  switch (element.rotation) {
    case 90:
      return { x: x - h, y, width: h, height: w };
    case 180:
      return { x: x - w, y: y - h, width: w, height: h };
    case 270:
      return { x, y: y - w, width: h, height: w };
    default:
      return { x, y, width: w, height: h };
  }
}

export function elementName(element: LabelElement): string {
  if (element.variable) return VARIABLE_LABELS[element.variable] ?? element.variable;
  if (element.type === "text") {
    const text = (element.content ?? "").replace(/\{\{(\w+)\}\}/g, (match, name: string) => (name in VARIABLE_LABELS ? VARIABLE_LABELS[name as LabelVariable] : match)).trim();
    return text || "Text";
  }
  return TYPE_NAMES[element.type];
}

const TYPE_NAMES: Record<LabelElement["type"], string> = {
  text: "Text",
  barcode: "Barcode",
  qrcode: "QR code",
  datamatrix: "Data Matrix",
  aztec: "Aztec",
  maxicode: "MaxiCode",
  pdf417: "PDF417",
  composite: "Composite",
  rss: "GS1 DataBar",
  line: "Line",
  box: "Box",
};

export type PreviewIssue = { elementId: string; message: string };

const EPSILON = 0.05;

function intersects(a: Rect, b: Rect): boolean {
  return a.x + a.width > b.x + EPSILON && b.x + b.width > a.x + EPSILON && a.y + a.height > b.y + EPSILON && b.y + b.height > a.y + EPSILON;
}

/**
 * What would print badly with these values: anything past the label edge, a symbol without its
 * quiet zone on the label, a symbol that cannot encode its value, and overlapping elements.
 */
export function previewIssues(document: LabelDocument, values: LabelValues): PreviewIssue[] {
  const issues: PreviewIssue[] = [];
  const { widthMm, heightMm } = document.page;
  const placed = document.elements.map((element) => {
    const shape = elementShape(element, values);
    return { element, shape, bounds: elementBounds(element, shape) };
  });
  for (const { element, shape, bounds } of placed) {
    const name = elementName(element);
    if (bounds.x < -EPSILON || bounds.y < -EPSILON || bounds.x + bounds.width > widthMm + EPSILON || bounds.y + bounds.height > heightMm + EPSILON) {
      issues.push({ elementId: element.id, message: `${name} runs past the label edge` });
    } else if ((shape.kind === "qrcode" || shape.kind === "barcode") && element.quietZoneMm) {
      const zone = element.quietZoneMm;
      if (bounds.x - zone < -EPSILON || bounds.y - zone < -EPSILON || bounds.x + bounds.width + zone > widthMm + EPSILON || bounds.y + bounds.height + zone > heightMm + EPSILON) {
        issues.push({ elementId: element.id, message: `${name} has less than ${zone} mm quiet zone` });
      }
    }
    if (shape.kind === "qrcode" && !shape.matrix) issues.push({ elementId: element.id, message: `${name} has no value to encode` });
    if (shape.kind === "barcode" && !shape.pattern) issues.push({ elementId: element.id, message: `${name} cannot encode "${shape.text}" as ${element.symbology ?? "a barcode"}` });
  }
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const a = placed[i]!;
      const b = placed[j]!;
      if (a.element.type === "box" || b.element.type === "box") continue;
      if (intersects(a.bounds, b.bounds)) issues.push({ elementId: b.element.id, message: `${elementName(b.element)} overlaps ${elementName(a.element)}` });
    }
  }
  return issues;
}
