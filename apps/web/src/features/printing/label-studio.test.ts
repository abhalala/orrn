import { describe, expect, test } from "bun:test";

import { compactLabel, operationsDense, polishedLabel, te200Profile, validateLabelDocument } from "@orrn/domain";

import {
  alignElements,
  deleteElement,
  duplicateElement,
  labelDocumentFromSchema,
  moveElement,
  newLabelEditor,
  redo,
  resizeElement,
  rotateElement,
  undo,
} from "./label-studio-model";

describe("label studio editor state", () => {
  test("converts legacy dot-based templates without losing geometry or variables", () => {
    const document = labelDocumentFromSchema({
      name: "Bundle",
      width_mm: 102.25,
      height_mm: 76.2,
      gap_mm: 3,
      dpi: 203,
      elements: [
        { type: "text", x: 20, y: 20, content: "{{serial}}", font: "3" },
        { type: "barcode", x: 20, y: 80, content: "{{serial}}", symbology: "128", height: 60, narrow: 2, wide: 2 },
      ],
    });
    expect(document.page).toEqual({ widthMm: 102.25, heightMm: 76.2, gapMm: 3, dpi: 203, speedInSec: 5, density: 8, direction: 0 });
    expect(document.elements[0]).toMatchObject({ xMm: 20 * 25.4 / 203, yMm: 20 * 25.4 / 203, font: "Sans Serif", content: "{{serialNumber}}" });
    expect(document.elements[1]).toMatchObject({ heightMm: 60 * 25.4 / 203, quietZoneMm: 2, humanReadable: true, content: "{{serialNumber}}" });
  });

  test("moves, rotates, duplicates, deletes, and reapplies history", () => {
    let state = newLabelEditor(operationsDense);
    state = moveElement(state, "serial", 1.25, 0);
    expect(state.document.elements[0]!.xMm).toBe(5.25);
    state = rotateElement(state, "serial");
    expect(state.document.elements[0]!.rotation).toBe(90);
    state = duplicateElement(state, "serial");
    expect(state.document.elements).toHaveLength(operationsDense.elements.length + 1);
    expect(new Set(state.document.elements.map((element) => element.id)).size).toBe(state.document.elements.length);
    state = deleteElement(state, state.document.elements.at(-1)!.id);
    expect(state.document.elements).toHaveLength(operationsDense.elements.length);
    state = undo(state);
    expect(state.document.elements).toHaveLength(operationsDense.elements.length + 1);
    state = undo(state);
    expect(state.document.elements[0]!.rotation).toBe(90);
    state = undo(state);
    expect(state.document.elements[0]!.rotation).toBe(0);
    state = undo(state);
    expect(state.document.elements[0]!.xMm).toBe(4);
    state = redo(state);
    expect(state.document.elements[0]!.xMm).toBe(5.25);
    expect(state.future).toHaveLength(3);
  });

  test("resizes and aligns without losing document validity", () => {
    let state = newLabelEditor(polishedLabel);
    state = resizeElement(state, "qr", 20, 20);
    expect(state.document.elements[1]!.widthMm).toBe(20);
    expect(validateLabelDocument(state.document, te200Profile)).toEqual([]);
    state = alignElements(state, "left");
    expect(state.document.elements.every((element) => element.xMm === 0)).toBe(true);
    expect(validateLabelDocument(state.document, te200Profile)).toEqual([]);
    state = alignElements(state, "bottom");
    expect(state.document.elements.every((element) => element.yMm === 76.2 - (element.heightMm ?? 0))).toBe(true);
  });

  test("keeps all three built-ins publishable and reports invalid content", () => {
    expect(validateLabelDocument(operationsDense, te200Profile)).toEqual([]);
    expect(validateLabelDocument(polishedLabel, te200Profile)).toEqual([]);
    expect(validateLabelDocument(compactLabel, te200Profile)).toEqual([]);
    const invalid = structuredClone(operationsDense);
    invalid.elements[0]!.variable = "uuid";
    expect(validateLabelDocument(invalid, te200Profile)[0]?.message).toBe("Forbidden label variable: uuid");
  });
});
