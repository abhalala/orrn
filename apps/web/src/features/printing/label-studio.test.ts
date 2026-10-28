import { describe, expect, test } from "bun:test";

import { compactLabel, operationsDense, polishedLabel, te200Profile, validateLabelDocument, type LabelElement } from "@orrn/domain";

import { SAMPLE_BUNDLE, elementBounds, elementShape, previewIssues, resolveContent } from "./label-metrics";
import {
  addElement,
  alignElements,
  deleteElements,
  distributeElements,
  duplicateElements,
  labelDocumentFromSchema,
  moveElements,
  moveLayer,
  newLabelEditor,
  pasteElements,
  redo,
  rotateElements,
  selectElement,
  undo,
} from "./label-studio-model";

const boundsOf = (element: LabelElement) => elementBounds(element, elementShape(element, SAMPLE_BUNDLE));

describe("legacy templates", () => {
  test("convert dot geometry and font scale to the same printed size, without legacy keys", () => {
    const document = labelDocumentFromSchema({
      name: "Bundle",
      width_mm: 102.25,
      height_mm: 76.2,
      gap_mm: 3,
      dpi: 203,
      elements: [
        { type: "text", x: 30, y: 30, content: "{{serial}}", font: "3", x_scale: 2, y_scale: 2 },
        { type: "barcode", x: 30, y: 110, content: "{{serialNumber}}", symbology: "128", height: 70, narrow: 2, wide: 2 },
      ],
    });
    expect(document.page).toEqual({ widthMm: 102.25, heightMm: 76.2, gapMm: 3, dpi: 203, speedInSec: 5, density: 8, direction: 0 });
    expect(document.elements[0]).toEqual({ id: "element-0", type: "text", xMm: 3.75, yMm: 3.75, rotation: 0, content: "{{serialNumber}}", font: "Sans Serif", fontSizeMm: 6 });
    expect(document.elements[1]).toMatchObject({ heightMm: 8.76, quietZoneMm: 2, humanReadable: true, narrow: 2 });
    expect(Object.keys(document.elements[1]!)).not.toContain("height");
    // A scale-2 legacy text prints in the 6 mm tall font-3 cell, same as before conversion.
    expect(elementShape(document.elements[0]!, SAMPLE_BUNDLE)).toMatchObject({ kind: "text", scale: 2 });
    expect(validateLabelDocument(document, te200Profile)).toEqual([]);
  });
});

describe("printed geometry", () => {
  test("variable wins over content and placeholders fill from bundle values", () => {
    expect(resolveContent({ id: "a", type: "text", xMm: 0, yMm: 0, rotation: 0, variable: "weight", content: "right" }, SAMPLE_BUNDLE)).toBe(SAMPLE_BUNDLE.weight);
    expect(resolveContent({ id: "b", type: "text", xMm: 0, yMm: 0, rotation: 0, content: "{{quantity}} pcs" }, SAMPLE_BUNDLE)).toBe(`${SAMPLE_BUNDLE.quantity} pcs`);
  });

  test("text measures 2 × 3 mm per character per font step, rotated boxes swap axes", () => {
    const text: LabelElement = { id: "t", type: "text", xMm: 10, yMm: 10, rotation: 0, content: "ABCDE", font: "Sans Serif", fontSizeMm: 6 };
    const shape = elementShape(text, SAMPLE_BUNDLE);
    expect(shape.widthMm).toBeCloseTo(5 * 4.003, 2);
    expect(shape.heightMm).toBeCloseTo(6.005, 2);
    const turned = elementBounds({ ...text, rotation: 90 }, shape);
    expect(turned.width).toBeCloseTo(shape.heightMm, 5);
    expect(turned.x).toBeCloseTo(10 - shape.heightMm, 1);
  });

  test("flags text past the label edge and overlapping elements", () => {
    const document = structuredClone(compactLabel);
    document.elements[0]!.xMm = 90;
    document.elements[3]!.yMm = 33;
    const messages = previewIssues(document, SAMPLE_BUNDLE).map((issue) => issue.message);
    expect(messages).toContain("Bundle number runs past the label edge");
    expect(messages).toContain("Total weight overlaps Series");
  });

  test("every built-in prints inside the label with no overlaps for a long tenant QR", () => {
    const values = { ...SAMPLE_BUNDLE, qr: "https://fourcubes.orrn.in/b/J2410187?c=fourcubes", weight: "1234.567 kg" };
    for (const document of [operationsDense, polishedLabel, compactLabel]) {
      expect(validateLabelDocument(document, te200Profile)).toEqual([]);
      expect(previewIssues(document, values)).toEqual([]);
    }
  });
});

describe("editor operations", () => {
  test("moves the selection as one undo step and restores it", () => {
    let state = newLabelEditor(operationsDense);
    state = moveElements(state, ["serial", "qr"], 1.25, -0.5);
    expect(state.document.elements.slice(0, 2).map((element) => [element.xMm, element.yMm])).toEqual([
      [5.25, 3.5],
      [75.25, 2.5],
    ]);
    state = undo(state);
    expect(state.document.elements[0]!.xMm).toBe(4);
    state = redo(state);
    expect(state.document.elements[0]!.xMm).toBe(5.25);
  });

  test("aligns only the selection: one element to the label, several to their shared edge", () => {
    let state = newLabelEditor(operationsDense);
    state = alignElements(state, ["quantity-label", "length-label"], "top", boundsOf);
    expect(state.document.elements.find((element) => element.id === "serial")!.yMm).toBe(4);
    state = alignElements(state, ["qr"], "right", boundsOf);
    const qr = state.document.elements.find((element) => element.id === "qr")!;
    const right = boundsOf(qr).x + boundsOf(qr).width;
    expect(right).toBeLessThanOrEqual(102.25);
    expect(right).toBeGreaterThan(102.25 - 0.13);
    state = alignElements(state, ["quantity-label", "length-label"], "left", boundsOf);
    expect(state.document.elements.filter((element) => element.id.endsWith("-label") && ["quantity-label", "length-label"].includes(element.id)).map((element) => element.xMm)).toEqual([4, 4]);
  });

  test("distributes three or more with equal gaps and keeps the ends", () => {
    let state = newLabelEditor(operationsDense);
    state = moveElements(state, ["length-label"], 10, 0);
    state = distributeElements(state, ["quantity-label", "length-label", "cast-label"], "horizontal", boundsOf);
    const boxes = ["quantity-label", "length-label", "cast-label"].map((id) => boundsOf(state.document.elements.find((element) => element.id === id)!));
    expect(boxes[0]!.x).toBeCloseTo(4, 1);
    // Equal to within one 203 dpi dot (0.125 mm), the printer's own resolution.
    expect(Math.abs(boxes[1]!.x - (boxes[0]!.x + boxes[0]!.width) - (boxes[2]!.x - (boxes[1]!.x + boxes[1]!.width)))).toBeLessThanOrEqual(0.13);
  });

  test("duplicate, paste and add produce unique ids and select the new elements", () => {
    let state = newLabelEditor(compactLabel);
    state = duplicateElements(state, ["serial", "series"]);
    expect(state.selectedIds).toEqual(["serial-copy", "series-copy"]);
    state = pasteElements(state, [compactLabel.elements[0]!], 4);
    expect(state.selectedIds).toEqual(["serial-2"]);
    expect(state.document.elements.at(-1)).toMatchObject({ xMm: 8, yMm: 8 });
    state = addElement(state, "text", "cast");
    expect(state.document.elements.at(-1)).toMatchObject({ id: "cast", variable: "cast", type: "text" });
    expect(state.document.elements.at(-1)!.content).toBeUndefined();
    expect(new Set(state.document.elements.map((element) => element.id)).size).toBe(state.document.elements.length);
    expect(validateLabelDocument(addElement(newLabelEditor(compactLabel), "datamatrix").document, te200Profile)).toEqual([]);
    expect(validateLabelDocument(addElement(newLabelEditor(compactLabel), "pdf417").document, te200Profile)).toEqual([]);
  });

  test("layers reorder print order and deleting clears the selection", () => {
    let state = newLabelEditor(compactLabel);
    state = moveLayer(state, "serial", "front");
    expect(state.document.elements.at(-1)!.id).toBe("serial");
    state = selectElement(state, "series");
    state = selectElement(state, "weight", true);
    expect(state.selectedIds).toEqual(["series", "weight"]);
    state = rotateElements(state, state.selectedIds);
    expect(state.document.elements.filter((element) => element.rotation === 90)).toHaveLength(2);
    state = deleteElements(state, state.selectedIds);
    expect(state.selectedIds).toEqual([]);
    expect(state.document.elements.map((element) => element.id)).toEqual(["serial-barcode", "serial"]);
  });
});
