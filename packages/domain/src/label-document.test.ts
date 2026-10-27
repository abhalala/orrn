import { describe, expect, test } from "bun:test";

import { te200Profile, validateLabelDocument, type LabelDocument } from "./label-document";

function validDocument(): LabelDocument {
  return {
    version: 1,
    page: { widthMm: 102.25, heightMm: 76.2, gapMm: 2, dpi: 203, speedInSec: 5, density: 8, direction: 0 },
    elements: [
      { id: "serial", type: "text", xMm: 4, yMm: 4, rotation: 0, variable: "serialNumber", font: "Sans Serif", fontSizeMm: 7 },
      { id: "qr", type: "qrcode", xMm: 76, yMm: 4, widthMm: 22, heightMm: 22, rotation: 0, variable: "qr", model: 2, mask: "auto", mode: "auto", cellMm: 1, quietZoneMm: 2 },
      { id: "weight", type: "text", xMm: 58, yMm: 67, rotation: 0, variable: "weight", font: "Sans Serif", fontSizeMm: 4.5 },
    ],
  };
}

describe("label document validation", () => {
  test("accepts a valid operations-dense document", () => {
    expect(validateLabelDocument(validDocument(), te200Profile)).toEqual([]);
  });

  test("rejects forbidden identifiers and TSPL injection", () => {
    let document = validDocument();
    // @ts-expect-error intentional invalid variable fixture
    document.elements[0]!.variable = "uuid";
    expect(validateLabelDocument(document, te200Profile)).toContainEqual({ path: "elements.0.variable", message: "Forbidden label variable: uuid" });
    document.elements[0]!.variable = "serialNumber";
    document.elements[0]!.content = "Hello\r\nCLS";
    expect(validateLabelDocument(document, te200Profile)).toContainEqual({ path: "elements.0.content", message: "Control characters are not allowed" });
  });

  test("rejects invalid page and element bounds", () => {
    let document = validDocument();
    document.page.widthMm = 200;
    expect(validateLabelDocument(document, te200Profile)).toContainEqual({ path: "page.widthMm", message: "Width is outside printer limits" });
    document = validDocument();
    document.elements[1]!.xMm = 90;
    expect(validateLabelDocument(document, te200Profile)).toContainEqual({ path: "elements.1", message: "Element exceeds printable area" });
  });

  test("rejects more than 64 elements", () => {
    let document = validDocument();
    document.elements = Array.from({ length: 65 }, (_, index) => ({ ...document.elements[0]!, id: `text-${index}` }));
    expect(validateLabelDocument(document, te200Profile)).toContainEqual({ path: "elements", message: "At most 64 elements are allowed" });
  });

  test("rejects unsupported font and symbology settings", () => {
    let document = validDocument();
    // @ts-expect-error intentional invalid font fixture
    document.elements[0]!.font = "Comic Sans";
    expect(validateLabelDocument(document, te200Profile)).toContainEqual({ path: "elements.0.font", message: "Unsupported font" });
    document = validDocument();
    // @ts-expect-error intentional invalid QR model fixture
    document.elements[1]!.model = 3;
    expect(validateLabelDocument(document, te200Profile)).toContainEqual({ path: "elements.1.model", message: "QR model must be 1 or 2" });
    // @ts-expect-error intentional invalid QR mask fixture
    document.elements[1]!.mask = "8";
    expect(validateLabelDocument(document, te200Profile)).toContainEqual({ path: "elements.1.mask", message: "Invalid QR mask" });
  });

  test("requires a barcode quiet zone", () => {
    let document = validDocument();
    document.elements[1]!.quietZoneMm = 1;
    expect(validateLabelDocument(document, te200Profile)).toContainEqual({ path: "elements.1.quietZoneMm", message: "Quiet zone must be at least 2 mm" });
  });
});
