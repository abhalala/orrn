import type { LabelDocument, LabelElement } from "./label-document";

/**
 * Built-in bundle labels, laid out against what the TE200/TA220 actually prints: TSPL font "3" is a
 * 16 × 24 dot cell (2 × 3 mm at 203 dpi) multiplied by a whole number, so text is 3 mm (×1) or 6 mm
 * (×2) tall, and a QR is modules × cell dots with no added quiet zone. Keep orrn-spool's
 * `internal/core/builtin_labels.go` identical.
 */
const page: LabelDocument["page"] = { widthMm: 102.25, heightMm: 76.2, gapMm: 2, dpi: 203, speedInSec: 5, density: 8, direction: 0 };

type TextSource = { variable: NonNullable<LabelElement["variable"]> } | { content: string };

function text(id: string, xMm: number, yMm: number, fontSizeMm: 3 | 6, source: TextSource): LabelElement {
  return { id, type: "text", xMm, yMm, rotation: 0, ...source, font: "Sans Serif", fontSizeMm, align: "left" };
}

/** 6-dot cells: a 33-module tenant QR address prints 24.8 mm square. */
function qr(id: string, xMm: number, yMm: number): LabelElement {
  return { id, type: "qrcode", xMm, yMm, widthMm: 25, heightMm: 25, rotation: 0, variable: "qr", level: "M", model: 2, mask: "auto", mode: "auto", cellMm: 0.75, quietZoneMm: 2 };
}

function serialBarcode(id: string, xMm: number, yMm: number, heightMm: number): LabelElement {
  return { id, type: "barcode", xMm, yMm, heightMm, rotation: 0, variable: "serialNumber", symbology: "128", narrow: 2, wide: 2, humanReadable: true, quietZoneMm: 2 };
}

const header = [text("serial", 4, 4, 6, { variable: "serialNumber" }), qr("qr", 74, 3)];

const measures = [
  text("quantity-label", 4, 13, 3, { content: "Quantity" }),
  text("quantity", 4, 17, 6, { variable: "quantity" }),
  text("length-label", 38, 13, 3, { content: "Cut length" }),
  text("length", 38, 17, 6, { variable: "length" }),
  text("weight12-label", 4, 27, 3, { content: "Weight / 12ft" }),
  text("weight12", 4, 31, 3, { variable: "weight12ft" }),
  text("weight-each-label", 38, 27, 3, { content: "Weight / cut" }),
  text("weight-each", 38, 31, 3, { variable: "weight_each" }),
  text("po-label", 4, 38, 3, { content: "PO" }),
  text("po", 4, 42, 3, { variable: "poNumber" }),
];

const total = [
  text("total-label", 56, 58, 3, { content: "Total weight" }),
  text("total", 56, 62, 6, { variable: "weight" }),
];

/** B: the default. Every operational field in aligned columns, serial and QR on top. */
export const operationsDense: LabelDocument = {
  version: 1,
  page,
  elements: [
    ...header,
    ...measures,
    text("sales-order-label", 38, 38, 3, { content: "Sales order" }),
    text("sales-order", 38, 42, 3, { variable: "salesOrder" }),
    text("cast-label", 74, 38, 3, { content: "Cast" }),
    text("cast", 74, 42, 3, { variable: "cast" }),
    text("series-label", 4, 49, 3, { content: "Series" }),
    text("series", 4, 53, 3, { variable: "seriesName" }),
    text("bis", 4, 60, 3, { variable: "standard" }),
    text("cml", 4, 64, 3, { variable: "cml" }),
    ...total,
  ],
};

/** A: the classic hierarchy without order, cast and BIS rows. */
export const polishedLabel: LabelDocument = {
  version: 1,
  page,
  elements: [
    ...header,
    ...measures,
    text("series-label", 4, 49, 3, { content: "Series" }),
    text("series", 4, 53, 3, { variable: "seriesName" }),
    ...total,
  ],
};

/** C: serial, scannable Code 128, series and weight. */
export const compactLabel: LabelDocument = {
  version: 1,
  page,
  elements: [
    text("serial", 4, 4, 6, { variable: "serialNumber" }),
    serialBarcode("serial-barcode", 4, 13, 12),
    text("series", 4, 33, 3, { variable: "seriesName" }),
    text("weight", 4, 39, 6, { variable: "weight" }),
  ],
};
