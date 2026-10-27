import { describe, expect, test } from "bun:test";

import { compactCurrent, legacyPolished, operationsDense } from "./builtin-labels";
import { te200Profile, validateLabelDocument } from "./label-document";
import type { LabelVariable } from "./labelContract";

describe("built-in label documents", () => {
  test("operations dense includes the complete operational hierarchy", () => {
    expect(validateLabelDocument(operationsDense, te200Profile)).toEqual([]);
    const variables = operationsDense.elements.map((element) => element.variable);
    const required: LabelVariable[] = ["serialNumber", "qr", "quantity", "length", "poNumber", "seriesName", "cast", "salesOrder", "standard", "cml", "weight12ft", "weight_each", "weight"];
    for (const requiredVariable of required) {
      expect(variables).toContain(requiredVariable);
    }
    expect(operationsDense.page.widthMm).toBe(102.25);
    expect(operationsDense.page.heightMm).toBe(76.2);
  });

  test("legacy polished and compact remain valid alternates", () => {
    expect(validateLabelDocument(legacyPolished, te200Profile)).toEqual([]);
    expect(validateLabelDocument(compactCurrent, te200Profile)).toEqual([]);
    expect(legacyPolished.elements.some((element) => element.type === "qrcode" && element.variable === "qr")).toBe(true);
    expect(compactCurrent.elements.some((element) => element.type === "barcode" && element.variable === "serialNumber")).toBe(true);
  });
});
