import { describe, expect, test } from "bun:test";

import { operationsDense, te200Profile, validateLabelDocument, type LabelDocument, type LabelElement } from "@orrn/domain";

import { SAMPLE_BUNDLE, elementShape, previewIssues, resolveContent } from "./label-metrics";
import {
  analyzePhoto,
  buildLabelDocument,
  captionVariable,
  cleanText,
  photoPage,
  serialFromQr,
  valueVariable,
  type DetectedCode,
  type DetectedLine,
  type ImportItem,
  type PhotoDetections,
} from "./label-photo-import";

const PAGE = photoPage(102.25, 76.2);
const WIDTH = 1600;
const HEIGHT = Math.round((WIDTH * PAGE.heightMm) / PAGE.widthMm);
const PX = WIDTH / PAGE.widthMm;

/** An OCR line the way Tesseract reports printed font-3 text at `fontSizeMm`, starting at the cell's top left in mm. */
function line(text: string, xMm: number, yMm: number, fontSizeMm = 3, confidence = 92): DetectedLine {
  const cell = fontSizeMm;
  const charMm = (2 * fontSizeMm) / 3;
  const descends = /[gjpqy,]/.test(text);
  const top = (yMm + 0.16 * cell) * PX;
  const height = (descends ? 0.86 : 0.68) * cell * PX;
  const words: DetectedLine["words"] = [];
  let at = 0;
  for (const word of text.split(" ")) {
    if (word) words.push({ text: word, confidence, box: { x: (xMm + at * charMm) * PX, y: top, width: word.length * charMm * 0.95 * PX, height } });
    at += word.length + 1;
  }
  const last = words.at(-1)!;
  return { text, confidence, box: { x: xMm * PX, y: top, width: last.box.x + last.box.width - xMm * PX, height }, words };
}

function code(format: string, value: string, xMm: number, yMm: number, widthMm: number, heightMm: number): DetectedCode {
  return { format, value, box: { x: xMm * PX, y: yMm * PX, width: widthMm * PX, height: heightMm * PX } };
}

const detections = (lines: DetectedLine[], codes: DetectedCode[] = []): PhotoDetections => ({ width: WIDTH, height: HEIGHT, lines, codes });

/** What a photo of a printed document reads as: its text elements as OCR lines, its QR as a code. */
function photographed(document: LabelDocument): PhotoDetections {
  const lines: DetectedLine[] = [];
  const codes: DetectedCode[] = [];
  for (const element of document.elements) {
    const shape = elementShape(element, SAMPLE_BUNDLE);
    if (element.type === "text") lines.push(line(resolveContent(element, SAMPLE_BUNDLE), element.xMm, element.yMm, element.fontSizeMm));
    if (element.type === "qrcode") codes.push(code("qr_code", SAMPLE_BUNDLE.qr, element.xMm, element.yMm, shape.widthMm, shape.heightMm));
  }
  return detections(lines, codes);
}

const byText = (items: ImportItem[], text: string) => items.find((item) => item.text === text);
const bound = (document: LabelDocument, variable: string) => document.elements.find((element) => element.variable === variable);

describe("captions and values", () => {
  test("recognises the captions printed on bundle labels", () => {
    const cases: Array<[string, string]> = [
      ["Quantity", "quantity"],
      ["Qty:", "quantity"],
      ["PCS", "quantity"],
      ["Cut length", "length"],
      ["Length", "length"],
      ["PO", "poNumber"],
      ["P.O. No.", "poNumber"],
      ["Series", "seriesName"],
      ["Cast", "cast"],
      ["Sales order", "salesOrder"],
      ["SO", "salesOrder"],
      ["Weight / 12ft", "weight12ft"],
      ["Wt/12ft", "weight12ft"],
      ["Weight / cut", "weight_each"],
      ["Weight each", "weight_each"],
      ["Total weight", "weight"],
      ["Net wt.", "weight"],
      ["Weight", "weight"],
      ["BIS", "standard"],
      ["IS", "standard"],
      ["CML No", "cml"],
      ["Party", "partyNo"],
      ["Bundle no", "serialNumber"],
    ];
    for (const [caption, variable] of cases) expect([caption, captionVariable(caption)]).toEqual([caption, variable as never]);
    expect(captionVariable("Aluminium profiles")).toBeNull();
  });

  test("falls back to value patterns", () => {
    expect(valueVariable("1.78 kg/12ft", null)).toBe("weight12ft");
    expect(valueVariable("48.7 kg", null)).toBe("weight");
    expect(valueVariable("24 pcs", null)).toBe("quantity");
    expect(valueVariable("13.66 ft", null)).toBe("length");
    expect(valueVariable("IS 733", null)).toBe("standard");
    expect(valueVariable("CML-4100231", null)).toBe("cml");
    expect(valueVariable("26J9094", null)).toBe("serialNumber");
    expect(valueVariable("X9", "X9")).toBe("serialNumber");
    expect(valueVariable("Handle with care", null)).toBeNull();
  });

  test("reads the bundle number out of the bundle QR", () => {
    expect(serialFromQr("https://plant.orrn.in/b/26J9094?c=plant")).toBe("26J9094");
    expect(serialFromQr("26J9094")).toBe("26J9094");
    expect(serialFromQr("https://example.com/")).toBeNull();
  });

  test("cleans text to something printable", () => {
    expect(cleanText("  Total\u0007 weight || ")).toBe("Total weight");
    expect(cleanText("x".repeat(300))).toHaveLength(120);
    expect(cleanText("— PO —")).toBe("PO");
  });
});

describe("a photo of the operations dense label", () => {
  const items = analyzePhoto(photographed(operationsDense), PAGE);
  const document = buildLabelDocument(items, PAGE, SAMPLE_BUNDLE);

  test("binds every value to its field through its caption or its pattern", () => {
    for (const element of operationsDense.elements) {
      if (!element.variable) continue;
      const made = bound(document, element.variable);
      expect([element.variable, made?.type]).toEqual([element.variable, element.type]);
    }
  });

  test("keeps the captions as fixed text", () => {
    for (const caption of ["Quantity", "Cut length", "Weight / 12ft", "Weight / cut", "PO", "Sales order", "Cast", "Series", "Total weight"]) {
      const item = byText(items, caption);
      expect([caption, item?.role, item?.binding]).toEqual([caption, "caption", null]);
      expect(document.elements.some((element) => element.content === caption)).toBe(true);
    }
  });

  test("snaps each text to the printer's 3 mm font steps and puts it where it was", () => {
    for (const original of operationsDense.elements.filter((element) => element.type === "text")) {
      const made = original.variable ? bound(document, original.variable) : document.elements.find((element) => element.content === original.content);
      expect([original.id, made?.fontSizeMm]).toEqual([original.id, original.fontSizeMm]);
      expect(Math.abs(made!.xMm - original.xMm)).toBeLessThan(0.3);
      expect(Math.abs(made!.yMm - original.yMm)).toBeLessThan(0.3);
    }
  });

  test("makes the QR a bound QR with whole-dot cells from its module pitch", () => {
    const qr = bound(document, "qr")!;
    expect(qr.type).toBe("qrcode");
    expect(qr.cellMm).toBe(0.75);
    expect(qr.quietZoneMm).toBe(2);
    expect(Math.abs(qr.xMm - 74)).toBeLessThan(0.3);
  });

  test("is a valid TE200 document that prints the sample cleanly", () => {
    expect(validateLabelDocument(document, te200Profile)).toEqual([]);
    expect(previewIssues(document, SAMPLE_BUNDLE)).toEqual([]);
    expect(new Set(document.elements.map((element) => element.id)).size).toBe(document.elements.length);
  });
});

describe("photo details", () => {
  test('splits "Caption: value" on one line into a caption and a bound field', () => {
    const items = analyzePhoto(detections([line("Qty: 24", 4, 10, 6)]), PAGE);
    expect(items.map((item) => [item.text, item.role, item.binding])).toEqual([
      ["Qty:", "caption", null],
      ["24", "value", "quantity"],
    ]);
    const [caption, value] = items;
    expect(value!.element.xMm).toBeGreaterThan(caption!.element.xMm + 8);
  });

  test("binds a value beside its caption on the same row", () => {
    const items = analyzePhoto(detections([line("Cast", 4, 10), line("K31", 30, 10)]), PAGE);
    expect(byText(items, "K31")?.binding).toBe("cast");
  });

  test("a whole value is not split into a caption and a number", () => {
    const items = analyzePhoto(detections([line("IS 733", 4, 10), line("PO-2471", 4, 20)]), PAGE);
    expect(items.map((item) => [item.text, item.binding])).toEqual([
      ["IS 733", "standard"],
      ["PO-2471", "poNumber"],
    ]);
  });

  test("leaves unknown text fixed and drops low-confidence noise and text read inside a code", () => {
    const items = analyzePhoto(
      detections(
        [line("ALUMINIUM PROFILES", 4, 4), line("~~ r4 ;", 4, 40, 3, 21), line("XQZ", 75, 8)],
        [code("qr_code", "https://plant.orrn.in/b/26J9094?c=plant", 74, 3, 25, 25)],
      ),
      PAGE,
    );
    expect(items.map((item) => [item.kind, item.text, item.binding])).toEqual([
      ["qrcode", "https://plant.orrn.in/b/26J9094?c=plant", "qr"],
      ["text", "ALUMINIUM PROFILES", null],
    ]);
  });

  test("a Code 128 of the QR's bundle binds the bundle number, with its printed value", () => {
    const items = analyzePhoto(
      detections([line("26J9094", 10, 31)], [code("qr_code", "https://plant.orrn.in/b/26J9094?c=plant", 74, 3, 25, 25), code("code_128", "26J9094", 10, 18, 30, 12)]),
      PAGE,
    );
    expect(items).toHaveLength(2);
    const barcode = items.find((item) => item.kind === "barcode")!;
    expect(barcode.binding).toBe("serialNumber");
    expect(barcode.element).toMatchObject({ symbology: "128", heightMm: 12, humanReadable: true, quietZoneMm: 2 });
    expect(barcode.element.narrow).toBeGreaterThanOrEqual(1);
    const document = buildLabelDocument(items, PAGE, SAMPLE_BUNDLE);
    expect(validateLabelDocument(document, te200Profile)).toEqual([]);
  });

  test("snaps font size from line height to whole 3 mm steps", () => {
    const items = analyzePhoto(detections([line("A1", 4, 4, 3), line("B2", 4, 12, 6), line("C3", 4, 24, 9), line("D4", 4, 40, 12)]), PAGE);
    expect(items.map((item) => item.element.fontSizeMm)).toEqual([3, 6, 9, 12]);
  });

  test("clamps everything inside the label and rounds to 2 decimals", () => {
    const items = analyzePhoto(
      detections([line("WIDE TEXT NEAR THE EDGE", 80, 72, 6), line("48.7 kg", 101, 1, 6)], [code("qr_code", "https://plant.orrn.in/b/26J9094?c=plant", 90.3333, 65.1111, 25, 25)]),
      PAGE,
    );
    const document = buildLabelDocument(items, PAGE, SAMPLE_BUNDLE);
    expect(validateLabelDocument(document, te200Profile)).toEqual([]);
    const edge = previewIssues(document, SAMPLE_BUNDLE).filter((issue) => issue.message.includes("past the label edge") || issue.message.includes("quiet zone"));
    expect(edge).toEqual([]);
    for (const element of document.elements) {
      expect(Math.round(element.xMm * 100) / 100).toBe(element.xMm);
      expect(Math.round(element.yMm * 100) / 100).toBe(element.yMm);
    }
  });

  test("the review's choices decide the document: excluded items go, bindings change the source", () => {
    const items = analyzePhoto(detections([line("Quantity", 4, 13), line("24", 4, 17, 6), line("Handle with care", 4, 40)]), PAGE);
    const edited = items.map((item): ImportItem => {
      if (item.text === "Handle with care") return { ...item, included: false };
      if (item.text === "24") return { ...item, binding: null };
      if (item.text === "Quantity") return { ...item, binding: "length" };
      return item;
    });
    const document = buildLabelDocument(edited, PAGE, SAMPLE_BUNDLE);
    expect(document.elements.map((element: LabelElement) => [element.content, element.variable])).toEqual([
      [undefined, "length"],
      ["24", undefined],
    ]);
  });

  test("includes at most 64 elements", () => {
    const lines = Array.from({ length: 70 }, (_, index) => line(`Row ${index}`, 4 + (index % 2) * 50, (index >> 1) * 2.1, 3));
    const items = analyzePhoto(detections(lines), photoPage(102.25, 152.4));
    expect(items.filter((item) => item.included)).toHaveLength(64);
    const document = buildLabelDocument(items, photoPage(102.25, 152.4), SAMPLE_BUNDLE);
    expect(document.elements).toHaveLength(64);
  });
});
