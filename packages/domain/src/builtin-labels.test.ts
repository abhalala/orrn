import { describe, expect, test } from "bun:test";

import { compactLabel, polishedLabel, operationsDense } from "./builtin-labels";
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

  test("polished and compact remain valid alternates", () => {
    expect(validateLabelDocument(polishedLabel, te200Profile)).toEqual([]);
    expect(validateLabelDocument(compactLabel, te200Profile)).toEqual([]);
    expect(polishedLabel.elements.some((element) => element.type === "qrcode" && element.variable === "qr")).toBe(true);
    expect(compactLabel.elements.some((element) => element.type === "barcode" && element.variable === "serialNumber")).toBe(true);
  });
});
