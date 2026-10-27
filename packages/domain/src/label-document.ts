import { LABEL_VARIABLES, type LabelVariable } from "./labelContract";

export type LabelRotation = 0 | 90 | 180 | 270;
export type LabelElementType = "text" | "barcode" | "qrcode" | "datamatrix" | "aztec" | "maxicode" | "pdf417" | "composite" | "rss" | "line" | "box";

export interface LabelPage {
  widthMm: number;
  heightMm: number;
  gapMm: number;
  dpi: 203;
  speedInSec: 2 | 3 | 4 | 5 | 6;
  density: number;
  direction: 0 | 1;
}

export interface LabelElement {
  id: string;
  type: LabelElementType;
  xMm: number;
  yMm: number;
  rotation: LabelRotation;
  content?: string;
  variable?: LabelVariable;
  font?: "Sans Serif" | "Font 3";
  fontSizeMm?: number;
  widthMm?: number;
  heightMm?: number;
  quietZoneMm?: number;
  symbology?: string;
  narrow?: number;
  wide?: number;
  humanReadable?: boolean;
  level?: "L" | "M" | "Q" | "H";
  cellMm?: number;
  model?: 1 | 2;
  mask?: "auto" | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7";
  mode?: "auto" | "manual";
  ecc?: 200;
  moduleMm?: number;
  aztecType?: "auto" | "compact" | "full" | "rune";
  layers?: number;
  errorCorrection?: number;
  whiteOnBlack?: boolean;
  maxicodeMode?: 2 | 3 | 4 | 5;
  columns?: number;
  security?: number;
  truncated?: boolean;
  compositeType?: string;
  rssType?: string;
  strokeMm?: number;
  align?: "left" | "center" | "right";
}

export interface LabelDocument {
  version: 1;
  page: LabelPage;
  elements: LabelElement[];
}

export interface LabelPrinterProfile {
  name: "TE200";
  dpi: 203;
  minWidthMm: number;
  maxWidthMm: number;
  minHeightMm: number;
  maxHeightMm: number;
  speedsInSec: readonly number[];
}

export interface LabelIssue {
  path: string;
  message: string;
}

export const te200Profile: LabelPrinterProfile = {
  name: "TE200",
  dpi: 203,
  minWidthMm: 5,
  maxWidthMm: 112,
  minHeightMm: 5,
  maxHeightMm: 2794,
  speedsInSec: [2, 3, 4, 5, 6],
};

const rotations: Record<number, true> = { 0: true, 90: true, 180: true, 270: true };
const fonts: Record<string, true> = { "Sans Serif": true, "Font 3": true };
const variables = new Set<string>(LABEL_VARIABLES);
const barcodeTypes: Record<string, true> = { "128": true, "39": true, "93": true, CODABAR: true, EAN13: true, EAN8: true, I2OF5: true, MSI: true, POSTNET: true, UPCA: true, UPCE: true };
const compositeTypes: Record<string, true> = { RSS14: true, Truncated: true, Stacked: true, Omnidirectional: true, Limited: true, Expanded: true, ExpandedStacked: true, "128_CC_AB": true, "128_CC_C": true };
const rssTypes: Record<string, true> = { RSS14: true, Truncated: true, Stacked: true, Omnidirectional: true, Limited: true, Expanded: true, ExpandedStacked: true };

export function validateLabelDocument(document: LabelDocument, profile: LabelPrinterProfile): LabelIssue[] {
  const issues: LabelIssue[] = [];
  if (document.version !== 1) issues.push({ path: "version", message: "Label document version must be 1" });
  const { page } = document;
  if (page.widthMm < profile.minWidthMm || page.widthMm > profile.maxWidthMm) issues.push({ path: "page.widthMm", message: "Width is outside printer limits" });
  if (page.heightMm < profile.minHeightMm || page.heightMm > profile.maxHeightMm) issues.push({ path: "page.heightMm", message: "Height is outside printer limits" });
  if (!Number.isFinite(page.gapMm) || page.gapMm < 0 || page.gapMm > 50) issues.push({ path: "page.gapMm", message: "Gap must be between 0 and 50 mm" });
  if (page.dpi !== profile.dpi) issues.push({ path: "page.dpi", message: `DPI must be ${profile.dpi}` });
  if (!profile.speedsInSec.includes(page.speedInSec)) issues.push({ path: "page.speedInSec", message: "Unsupported print speed" });
  if (!Number.isInteger(page.density) || page.density < 0 || page.density > 15) issues.push({ path: "page.density", message: "Density must be between 0 and 15" });
  if (page.direction !== 0 && page.direction !== 1) issues.push({ path: "page.direction", message: "Direction must be 0 or 1" });
  for (const [key, value] of Object.entries(page)) {
    if (typeof value === "number" && !Number.isFinite(value)) issues.push({ path: `page.${key}`, message: "Must be finite" });
  }

  if (document.elements.length === 0) issues.push({ path: "elements", message: "At least one element is required" });
  if (document.elements.length > 64) issues.push({ path: "elements", message: "At most 64 elements are allowed" });
  const ids = new Set<string>();
  document.elements.forEach((element, index) => {
    const path = `elements.${index}`;
    if (!element.id || ids.has(element.id)) issues.push({ path: `${path}.id`, message: "Element id must be unique and non-empty" });
    ids.add(element.id);
    if (!rotations[element.rotation]) issues.push({ path: `${path}.rotation`, message: "Rotation must be 0, 90, 180, or 270" });
    if (element.xMm < 0 || element.yMm < 0 || element.xMm > page.widthMm || element.yMm > page.heightMm) issues.push({ path, message: "Element exceeds printable area" });
    if (element.widthMm !== undefined && (element.widthMm <= 0 || element.xMm + element.widthMm > page.widthMm)) issues.push({ path, message: "Element exceeds printable area" });
    if (element.heightMm !== undefined && (element.heightMm <= 0 || element.yMm + element.heightMm > page.heightMm)) issues.push({ path, message: "Element exceeds printable area" });
    if (element.variable && !variables.has(element.variable)) issues.push({ path: `${path}.variable`, message: `Forbidden label variable: ${element.variable}` });
    if (element.content !== undefined && /[\u0000-\u001f\u007f]/.test(element.content)) issues.push({ path: `${path}.content`, message: "Control characters are not allowed" });

    switch (element.type) {
      case "text":
        if (!element.font || !fonts[element.font]) issues.push({ path: `${path}.font`, message: "Unsupported font" });
        if (!element.fontSizeMm || element.fontSizeMm < 1 || element.fontSizeMm > 50) issues.push({ path: `${path}.fontSizeMm`, message: "Font size must be between 1 and 50 mm" });
        if (!element.variable && !element.content) issues.push({ path: `${path}.content`, message: "Text content or variable is required" });
        break;
      case "barcode":
        if (!element.symbology || !barcodeTypes[element.symbology]) issues.push({ path: `${path}.symbology`, message: "Unsupported barcode symbology" });
        if (!element.heightMm || element.heightMm <= 0) issues.push({ path: `${path}.heightMm`, message: "Barcode height is required" });
        if (!element.narrow || !element.wide || element.narrow <= 0 || element.wide < element.narrow || element.wide > 10) issues.push({ path: `${path}.narrow`, message: "Invalid narrow/wide barcode ratio" });
        if ((element.quietZoneMm ?? 0) < 1) issues.push({ path: `${path}.quietZoneMm`, message: "Quiet zone must be at least 1 mm" });
        break;
      case "qrcode":
        if (element.model !== 1 && element.model !== 2) issues.push({ path: `${path}.model`, message: "QR model must be 1 or 2" });
        if (element.mask !== "auto" && !/^[0-7]$/.test(element.mask ?? "")) issues.push({ path: `${path}.mask`, message: "Invalid QR mask" });
        if (element.mode !== "auto" && element.mode !== "manual") issues.push({ path: `${path}.mode`, message: "QR mode must be auto or manual" });
        if (!element.cellMm || element.cellMm <= 0) issues.push({ path: `${path}.cellMm`, message: "QR cell size is required" });
        if ((element.quietZoneMm ?? 0) < 2) issues.push({ path: `${path}.quietZoneMm`, message: "Quiet zone must be at least 2 mm" });
        break;
      case "datamatrix":
        if (element.ecc !== 200) issues.push({ path: `${path}.ecc`, message: "Data Matrix requires ECC200" });
        if (!element.moduleMm || element.moduleMm <= 0) issues.push({ path: `${path}.moduleMm`, message: "Data Matrix module size is required" });
        if ((element.quietZoneMm ?? 0) < 2) issues.push({ path: `${path}.quietZoneMm`, message: "Quiet zone must be at least 2 mm" });
        break;
      case "aztec":
        if (!element.aztecType || !["auto", "compact", "full", "rune"].includes(element.aztecType)) issues.push({ path: `${path}.aztecType`, message: "Invalid Aztec type" });
        if (element.errorCorrection !== undefined && (element.errorCorrection < 0 || element.errorCorrection > 99)) issues.push({ path: `${path}.errorCorrection`, message: "Aztec error correction must be between 0 and 99" });
        if (element.layers !== undefined && (element.layers < 1 || element.layers > 32)) issues.push({ path: `${path}.layers`, message: "Aztec layers must be between 1 and 32" });
        break;
      case "maxicode":
        if (!element.maxicodeMode || element.maxicodeMode < 2 || element.maxicodeMode > 5) issues.push({ path: `${path}.maxicodeMode`, message: "MaxiCode mode must be between 2 and 5" });
        break;
      case "pdf417":
        if (!element.columns || element.columns < 1) issues.push({ path: `${path}.columns`, message: "PDF417 columns are required" });
        if (element.security === undefined || element.security < 0 || element.security > 8) issues.push({ path: `${path}.security`, message: "PDF417 security must be between 0 and 8" });
        break;
      case "composite":
        if (!element.compositeType || !compositeTypes[element.compositeType]) issues.push({ path: `${path}.compositeType`, message: "Unsupported composite type" });
        break;
      case "rss":
        if (!element.rssType || !rssTypes[element.rssType]) issues.push({ path: `${path}.rssType`, message: "Unsupported RSS type" });
        break;
      case "line":
      case "box":
        if (!element.strokeMm || element.strokeMm <= 0) issues.push({ path: `${path}.strokeMm`, message: "Stroke width is required" });
        break;
      default:
        issues.push({ path: `${path}.type`, message: "Unsupported element type" });
    }
  });
  return issues;
}
