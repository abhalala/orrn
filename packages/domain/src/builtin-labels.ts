import type { LabelDocument, LabelElement } from "./label-document";

const page: LabelDocument["page"] = { widthMm: 102.25, heightMm: 76.2, gapMm: 2, dpi: 203, speedInSec: 5, density: 8, direction: 0 };

function text(id: string, xMm: number, yMm: number, fontSizeMm: number, variable?: LabelElement["variable"], content?: string, align: LabelElement["align"] = "left"): LabelElement {
  return { id, type: "text", xMm, yMm, rotation: 0, variable, content, font: "Sans Serif", fontSizeMm, align };
}

function qr(id: string, xMm: number, yMm: number, sizeMm: number): LabelElement {
  return { id, type: "qrcode", xMm, yMm, widthMm: sizeMm, heightMm: sizeMm, rotation: 0, variable: "qr", model: 2, mask: "auto", mode: "auto", cellMm: 1, quietZoneMm: 2 };
}

function serialBarcode(id: string, xMm: number, yMm: number, heightMm: number): LabelElement {
  return { id, type: "barcode", xMm, yMm, heightMm, rotation: 0, variable: "serialNumber", symbology: "128", narrow: 2, wide: 2, humanReadable: true, quietZoneMm: 2 };
}

export const operationsDense: LabelDocument = {
  version: 1,
  page,
  elements: [
    text("serial", 4, 4, 7, "serialNumber"),
    qr("qr", 76, 4, 22),
    text("quantity-label", 4, 13, 2.2, undefined, "Quantity"),
    text("quantity", 4, 16.5, 4.2, "quantity", undefined),
    text("length-label", 4, 24, 2.2, undefined, "Cut Length"),
    text("length", 4, 27.5, 4.2, "length"),
    text("po-label", 4, 34, 2.2, undefined, "PO"),
    text("po", 4, 37, 3, "poNumber"),
    text("weight12-label", 58, 13, 2.2, undefined, "Weight / 12ft", "right"),
    text("weight12", 58, 16.5, 4.2, "weight12ft", "right"),
    text("weight-each-label", 58, 24, 2.2, undefined, "Weight / cut", "right"),
    text("weight-each", 58, 27.5, 4.2, "weight_each", "right"),
    text("series-label", 4, 46, 2.2, undefined, "Series Name"),
    text("series", 4, 49, 3, "seriesName"),
    text("cast", 4, 55, 2.4, "cast"),
    text("sales-order", 4, 59, 2.4, "salesOrder"),
    text("bis", 4, 63, 2.2, "standard"),
    text("cml", 4, 66, 2.2, "cml"),
    text("total-label", 58, 61, 2.2, undefined, "Total Weight", "right"),
    text("total", 58, 65, 4.5, "weight", "right"),
  ],
};

export const polishedLabel: LabelDocument = {
  version: 1,
  page,
  elements: [
    text("serial", 4, 4, 7, "serialNumber"),
    qr("qr", 76, 4, 22),
    text("quantity-label", 4, 13, 2.2, undefined, "Quantity"),
    text("quantity", 4, 16.5, 4.2, "quantity"),
    text("length-label", 4, 24, 2.2, undefined, "Cut Length"),
    text("length", 4, 27.5, 4.2, "length"),
    text("po-label", 4, 34, 2.2, undefined, "PO"),
    text("po", 4, 37, 3, "poNumber"),
    text("weight12-label", 58, 13, 2.2, undefined, "Weight / 12ft", "right"),
    text("weight12", 58, 16.5, 4.2, "weight12ft", "right"),
    text("weight-each-label", 58, 24, 2.2, undefined, "Weight / cut", "right"),
    text("weight-each", 58, 27.5, 4.2, "weight_each", "right"),
    text("series-label", 4, 52, 2.2, undefined, "Series Name"),
    text("series", 4, 55, 3, "seriesName"),
    text("total-label", 58, 61, 2.2, undefined, "Total Weight", "right"),
    text("total", 58, 65, 4.5, "weight", "right"),
  ],
};

export const compactLabel: LabelDocument = {
  version: 1,
  page,
  elements: [
    text("serial", 4, 4, 5.5, "serialNumber"),
    serialBarcode("serial-barcode", 4, 14, 14),
    text("series", 4, 34, 2.8, "seriesName"),
    text("weight", 4, 40, 3, "weight"),
  ],
};
