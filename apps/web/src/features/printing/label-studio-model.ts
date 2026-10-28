import type { LabelDocument, LabelElement, LabelPage } from "@orrn/domain";

import { dots, mmFromDots, round2, type Rect } from "./label-metrics";

/** Nearest printer-dot position; toward the origin when it must not cross a far edge. */
const onDot = (mm: number, inward = false) => round2(mmFromDots(inward ? Math.floor((mm * 203) / 25.4 + 1e-6) : dots(mm)));

export interface LabelEditorState {
  document: LabelDocument;
  selectedIds: string[];
  past: LabelDocument[];
  future: LabelDocument[];
}

type LegacySchema = Omit<Partial<LabelDocument>, "page"> & {
  width_mm?: number;
  height_mm?: number;
  gap_mm?: number;
  dpi?: number;
  page?: LabelDocument["page"];
};

const legacyVariables: Record<string, LabelElement["variable"]> = {
  serial: "serialNumber",
  bundleSerial: "serialNumber",
};

/** Dot-based keys of the legacy schema; their millimetre twins replace them. */
const LEGACY_KEYS = ["x", "y", "width", "height", "x_scale", "y_scale", "cell_width", "moduleSize"] as const;

function legacyVariable(value: unknown): LabelElement["variable"] | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return legacyVariables[value] ?? (value as LabelElement["variable"]);
}

function convertContent(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.replace(/\{\{(serial|bundleSerial)\}\}/g, "{{serialNumber}}");
}

/** Accepts both versioned documents and the legacy width_mm/dot schema. */
export function labelDocumentFromSchema(schema: unknown): LabelDocument {
  const source = (schema ?? {}) as LegacySchema;
  const dpi = source.page?.dpi ?? source.dpi ?? 203;
  const dotsToMm = (value: unknown) => (typeof value === "number" ? round2((value * 25.4) / dpi) : undefined);
  const elements = (source.elements ?? []) as Array<LabelElement & Record<string, unknown>>;
  return {
    version: 1,
    page: {
      widthMm: source.page?.widthMm ?? source.width_mm ?? 100,
      heightMm: source.page?.heightMm ?? source.height_mm ?? 75,
      gapMm: source.page?.gapMm ?? source.gap_mm ?? 3,
      dpi: 203,
      speedInSec: source.page?.speedInSec ?? 5,
      density: source.page?.density ?? 8,
      direction: source.page?.direction ?? 0,
    },
    elements: elements.map((element, index) => {
      const converted: LabelElement & Record<string, unknown> = {
        ...element,
        id: element.id || `element-${index}`,
        type: element.type,
        xMm: element.xMm ?? dotsToMm(element.x) ?? 0,
        yMm: element.yMm ?? dotsToMm(element.y) ?? 0,
        rotation: element.rotation ?? 0,
        content: convertContent(element.content),
        variable: legacyVariable(element.variable),
      };
      if (converted.widthMm === undefined) converted.widthMm = dotsToMm(element.width);
      if (converted.heightMm === undefined) converted.heightMm = dotsToMm(element.height);
      if (element.type === "text") {
        // Legacy text is font "3" scaled by x_scale/y_scale; 3 mm per step prints the same scale.
        const scale = Number(element.y_scale ?? element.x_scale ?? 1);
        converted.font = element.font && String(element.font) !== "3" ? element.font : "Sans Serif";
        converted.fontSizeMm = element.fontSizeMm ?? 3 * (Number.isFinite(scale) && scale > 0 ? scale : 1);
      }
      if (element.type === "barcode") {
        converted.quietZoneMm = element.quietZoneMm ?? 2;
        converted.humanReadable = element.humanReadable ?? true;
      }
      if (element.type === "qrcode") {
        converted.cellMm = element.cellMm ?? dotsToMm(element.cell_width);
        converted.model = element.model ?? 2;
        converted.mask = element.mask ?? "auto";
        converted.mode = element.mode ?? "auto";
        converted.quietZoneMm = element.quietZoneMm ?? 2;
      }
      if (element.type === "datamatrix") {
        converted.moduleMm = element.moduleMm ?? dotsToMm(element.moduleSize);
        converted.ecc = element.ecc ?? 200;
        converted.quietZoneMm = element.quietZoneMm ?? 2;
      }
      for (const key of LEGACY_KEYS) delete converted[key];
      for (const key of Object.keys(converted)) if (converted[key] === undefined) delete converted[key];
      return converted;
    }),
  };
}

export function newLabelEditor(document: LabelDocument): LabelEditorState {
  return { document: structuredClone(document), selectedIds: [], past: [], future: [] };
}

/** Plain click selects one; `additive` (Shift) toggles it in the selection. */
export function selectElement(state: LabelEditorState, id: string, additive = false): LabelEditorState {
  if (!additive) return { ...state, selectedIds: [id] };
  const selectedIds = state.selectedIds.includes(id) ? state.selectedIds.filter((selected) => selected !== id) : [...state.selectedIds, id];
  return { ...state, selectedIds };
}

export function selectElements(state: LabelEditorState, ids: string[]): LabelEditorState {
  return { ...state, selectedIds: ids };
}

function change(state: LabelEditorState, update: (document: LabelDocument) => LabelDocument, selectedIds = state.selectedIds): LabelEditorState {
  return {
    document: update(structuredClone(state.document)),
    selectedIds,
    past: [...state.past.slice(-49), structuredClone(state.document)],
    future: [],
  };
}

function replaceElements(document: LabelDocument, ids: readonly string[], update: (element: LabelElement) => LabelElement): LabelDocument {
  return { ...document, elements: document.elements.map((element) => (ids.includes(element.id) ? update(element) : element)) };
}

export function updateElement(state: LabelEditorState, id: string, update: (element: LabelElement) => LabelElement): LabelEditorState {
  return change(state, (document) => replaceElements(document, [id], update));
}

export function updatePage(state: LabelEditorState, update: Partial<LabelPage>): LabelEditorState {
  return change(state, (document) => ({ ...document, page: { ...document.page, ...update } }));
}

export function replaceDocument(state: LabelEditorState, document: LabelDocument): LabelEditorState {
  return change(state, () => structuredClone(document), []);
}

export function moveElements(state: LabelEditorState, ids: readonly string[], dxMm: number, dyMm: number): LabelEditorState {
  if (ids.length === 0 || (dxMm === 0 && dyMm === 0)) return state;
  return change(state, (document) => replaceElements(document, ids, (element) => ({ ...element, xMm: round2(element.xMm + dxMm), yMm: round2(element.yMm + dyMm) })));
}

export function rotateElements(state: LabelEditorState, ids: readonly string[]): LabelEditorState {
  if (ids.length === 0) return state;
  return change(state, (document) => replaceElements(document, ids, (element) => ({ ...element, rotation: ((element.rotation + 90) % 360) as LabelElement["rotation"] })));
}

function uniqueId(document: LabelDocument, base: string): string {
  const ids = new Set(document.elements.map((element) => element.id));
  if (!ids.has(base)) return base;
  let suffix = 2;
  while (ids.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

/** Copies land 2 mm down and right of their source and become the selection. */
export function duplicateElements(state: LabelEditorState, ids: readonly string[]): LabelEditorState {
  if (ids.length === 0) return state;
  const copies: LabelElement[] = [];
  const document = structuredClone(state.document);
  for (const element of state.document.elements) {
    if (!ids.includes(element.id)) continue;
    const id = uniqueId({ ...document, elements: [...document.elements, ...copies] }, `${element.id}-copy`);
    copies.push({ ...structuredClone(element), id, xMm: round2(element.xMm + 2), yMm: round2(element.yMm + 2) });
  }
  return change(state, (current) => ({ ...current, elements: [...current.elements, ...copies] }), copies.map((copy) => copy.id));
}

export function deleteElements(state: LabelEditorState, ids: readonly string[]): LabelEditorState {
  if (ids.length === 0) return state;
  return change(state, (document) => ({ ...document, elements: document.elements.filter((element) => !ids.includes(element.id)) }), []);
}

export type NewElementKind = "text" | "barcode" | "qrcode" | "datamatrix" | "pdf417" | "line" | "box";

const NEW_ELEMENTS: Record<NewElementKind, Omit<LabelElement, "id" | "xMm" | "yMm">> = {
  text: { type: "text", rotation: 0, content: "Text", font: "Sans Serif", fontSizeMm: 3, align: "left" },
  barcode: { type: "barcode", rotation: 0, variable: "serialNumber", symbology: "128", heightMm: 10, narrow: 2, wide: 2, humanReadable: true, quietZoneMm: 2 },
  qrcode: { type: "qrcode", rotation: 0, variable: "qr", level: "M", model: 2, mask: "auto", mode: "auto", cellMm: 0.75, quietZoneMm: 2, widthMm: 25, heightMm: 25 },
  line: { type: "line", rotation: 0, widthMm: 40, heightMm: 0.5, strokeMm: 0.5 },
  box: { type: "box", rotation: 0, widthMm: 30, heightMm: 15, strokeMm: 0.5 },
  datamatrix: { type: "datamatrix", rotation: 0, variable: "serialNumber", ecc: 200, moduleMm: 0.75, widthMm: 12, heightMm: 12, quietZoneMm: 2 },
  pdf417: { type: "pdf417", rotation: 0, variable: "serialNumber", moduleMm: 0.5, columns: 3, security: 2, widthMm: 40, heightMm: 12, quietZoneMm: 2 },
};

/** Adds a static element, or a text field bound to a frozen catalog variable, and selects it. */
export function addElement(state: LabelEditorState, kind: NewElementKind, variable?: LabelElement["variable"]): LabelEditorState {
  const base = variable ?? kind;
  const id = uniqueId(state.document, base);
  const template = structuredClone(NEW_ELEMENTS[kind]);
  const element: LabelElement = { ...template, id, xMm: 4, yMm: 4 };
  if (variable && kind === "text") {
    delete element.content;
    element.variable = variable;
  }
  return change(state, (document) => ({ ...document, elements: [...document.elements, element] }), [id]);
}

/** Pastes copies of `elements` 2 mm down and right (again for each paste) and selects them. */
export function pasteElements(state: LabelEditorState, elements: readonly LabelElement[], offsetMm = 2): LabelEditorState {
  if (elements.length === 0) return state;
  const copies: LabelElement[] = [];
  for (const element of elements) {
    const id = uniqueId({ ...state.document, elements: [...state.document.elements, ...copies] }, element.id);
    copies.push({ ...structuredClone(element), id, xMm: round2(element.xMm + offsetMm), yMm: round2(element.yMm + offsetMm) });
  }
  return change(state, (document) => ({ ...document, elements: [...document.elements, ...copies] }), copies.map((copy) => copy.id));
}

export type LayerMove = "forward" | "backward" | "front" | "back";

/** Later elements print on top; layer moves reorder the element list. */
export function moveLayer(state: LabelEditorState, id: string, move: LayerMove): LabelEditorState {
  const index = state.document.elements.findIndex((element) => element.id === id);
  if (index < 0) return state;
  const last = state.document.elements.length - 1;
  const target = move === "front" ? last : move === "back" ? 0 : move === "forward" ? Math.min(last, index + 1) : Math.max(0, index - 1);
  if (target === index) return state;
  return change(state, (document) => {
    const elements = [...document.elements];
    const [element] = elements.splice(index, 1);
    elements.splice(target, 0, element!);
    return { ...document, elements };
  });
}

export type Alignment = "left" | "center" | "right" | "top" | "middle" | "bottom";

/** One element aligns to the label; several align to the edges of their combined box. */
export function alignElements(state: LabelEditorState, ids: readonly string[], alignment: Alignment, boundsOf: (element: LabelElement) => Rect): LabelEditorState {
  const targets = state.document.elements.filter((element) => ids.includes(element.id));
  if (targets.length === 0) return state;
  const boxes = new Map(targets.map((element) => [element.id, boundsOf(element)]));
  const all = [...boxes.values()];
  const frame =
    targets.length === 1
      ? { x: 0, y: 0, width: state.document.page.widthMm, height: state.document.page.heightMm }
      : (() => {
          const left = Math.min(...all.map((box) => box.x));
          const top = Math.min(...all.map((box) => box.y));
          return { x: left, y: top, width: Math.max(...all.map((box) => box.x + box.width)) - left, height: Math.max(...all.map((box) => box.y + box.height)) - top };
        })();
  return change(state, (document) =>
    replaceElements(document, ids, (element) => {
      const box = boxes.get(element.id)!;
      const dx =
        alignment === "left" ? frame.x - box.x : alignment === "center" ? frame.x + (frame.width - box.width) / 2 - box.x : alignment === "right" ? frame.x + frame.width - box.width - box.x : 0;
      const dy =
        alignment === "top" ? frame.y - box.y : alignment === "middle" ? frame.y + (frame.height - box.height) / 2 - box.y : alignment === "bottom" ? frame.y + frame.height - box.height - box.y : 0;
      return { ...element, xMm: onDot(element.xMm + dx, alignment === "right"), yMm: onDot(element.yMm + dy, alignment === "bottom") };
    }),
  );
}

/** Equal gaps between three or more elements, first and last stay put. */
export function distributeElements(state: LabelEditorState, ids: readonly string[], axis: "horizontal" | "vertical", boundsOf: (element: LabelElement) => Rect): LabelEditorState {
  const targets = state.document.elements.filter((element) => ids.includes(element.id));
  if (targets.length < 3) return state;
  const horizontal = axis === "horizontal";
  const placed = targets
    .map((element) => ({ element, box: boundsOf(element) }))
    .sort((a, b) => (horizontal ? a.box.x - b.box.x : a.box.y - b.box.y));
  const start = horizontal ? placed[0]!.box.x : placed[0]!.box.y;
  const lastBox = placed.at(-1)!.box;
  const end = horizontal ? lastBox.x + lastBox.width : lastBox.y + lastBox.height;
  const occupied = placed.reduce((sum, { box }) => sum + (horizontal ? box.width : box.height), 0);
  const gap = (end - start - occupied) / (placed.length - 1);
  const deltas = new Map<string, number>();
  let cursor = start;
  for (const { element, box } of placed) {
    deltas.set(element.id, cursor - (horizontal ? box.x : box.y));
    cursor += (horizontal ? box.width : box.height) + gap;
  }
  return change(state, (document) =>
    replaceElements(document, ids, (element) => {
      const delta = deltas.get(element.id) ?? 0;
      return horizontal ? { ...element, xMm: round2(element.xMm + delta) } : { ...element, yMm: round2(element.yMm + delta) };
    }),
  );
}

export function undo(state: LabelEditorState): LabelEditorState {
  const previous = state.past.at(-1);
  if (!previous) return state;
  return {
    ...state,
    document: structuredClone(previous),
    past: state.past.slice(0, -1),
    future: [structuredClone(state.document), ...state.future],
    selectedIds: state.selectedIds.filter((id) => previous.elements.some((element) => element.id === id)),
  };
}

export function redo(state: LabelEditorState): LabelEditorState {
  const next = state.future[0];
  if (!next) return state;
  return {
    ...state,
    document: structuredClone(next),
    past: [...state.past, structuredClone(state.document)],
    future: state.future.slice(1),
    selectedIds: state.selectedIds.filter((id) => next.elements.some((element) => element.id === id)),
  };
}
