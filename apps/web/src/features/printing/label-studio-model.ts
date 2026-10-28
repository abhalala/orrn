import type { LabelDocument, LabelElement } from "@orrn/domain";

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
  const dotsToMm = (value: unknown) => (typeof value === "number" ? (value * 25.4) / dpi : undefined);
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
        converted.font = element.font && String(element.font) !== "3" ? element.font : "Sans Serif";
        converted.fontSizeMm = element.fontSizeMm ?? 3;
      }
      if (element.type === "barcode") {
        converted.quietZoneMm = element.quietZoneMm ?? 2;
        converted.humanReadable = true;
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
      return converted;
    }),
  };
}

export function newLabelEditor(document: LabelDocument): LabelEditorState {
  return { document: structuredClone(document), selectedIds: [], past: [], future: [] };
}

export function selectElement(state: LabelEditorState, id: string): LabelEditorState {
  return { ...state, selectedIds: [id] };
}

function change(state: LabelEditorState, update: (document: LabelDocument) => LabelDocument): LabelEditorState {
  return {
    ...state,
    document: update(structuredClone(state.document)),
    past: [...state.past.slice(-49), structuredClone(state.document)],
    future: [],
  };
}

function replaceElement(document: LabelDocument, id: string, update: (element: LabelElement) => LabelElement): LabelDocument {
  return { ...document, elements: document.elements.map((element) => (element.id === id ? update(element) : element)) };
}

export function updateElement(state: LabelEditorState, id: string, update: (element: LabelElement) => LabelElement): LabelEditorState {
  return change(state, (document) => replaceElement(document, id, update));
}

export function moveElement(state: LabelEditorState, id: string, dxMm: number, dyMm: number): LabelEditorState {
  return change(state, (document) => replaceElement(document, id, (element) => ({ ...element, xMm: element.xMm + dxMm, yMm: element.yMm + dyMm })));
}

export function resizeElement(state: LabelEditorState, id: string, widthMm: number, heightMm: number): LabelEditorState {
  return change(state, (document) => replaceElement(document, id, (element) => ({ ...element, widthMm, heightMm })));
}

export function rotateElement(state: LabelEditorState, id: string): LabelEditorState {
  return change(state, (document) => replaceElement(document, id, (element) => ({ ...element, rotation: ((element.rotation + 90) % 360) as LabelElement["rotation"] })));
}

export function duplicateElement(state: LabelEditorState, id: string): LabelEditorState {
  return change(state, (document) => {
    const source = document.elements.find((element) => element.id === id);
    if (!source) return document;
    const ids = new Set(document.elements.map((element) => element.id));
    let suffix = 1;
    let copyId = `${id}-copy`;
    while (ids.has(copyId)) {
      suffix += 1;
      copyId = `${id}-copy-${suffix}`;
    }
    return { ...document, elements: [...document.elements, { ...structuredClone(source), id: copyId }] };
  });
}

export function deleteElement(state: LabelEditorState, id: string): LabelEditorState {
  return change(state, (document) => ({ ...document, elements: document.elements.filter((element) => element.id !== id) }));
}

export function alignElements(state: LabelEditorState, alignment: "left" | "center" | "right" | "top" | "middle" | "bottom"): LabelEditorState {
  return change(state, (document) => ({
    ...document,
    elements: document.elements.map((element) => {
      const width = element.widthMm ?? 0;
      const height = element.heightMm ?? 0;
      return {
        ...element,
        xMm: alignment === "left" ? 0 : alignment === "center" ? (document.page.widthMm - width) / 2 : alignment === "right" ? document.page.widthMm - width : element.xMm,
        yMm: alignment === "top" ? 0 : alignment === "middle" ? (document.page.heightMm - height) / 2 : alignment === "bottom" ? document.page.heightMm - height : element.yMm,
      };
    }),
  }));
}

export function undo(state: LabelEditorState): LabelEditorState {
  const previous = state.past.at(-1);
  if (!previous) return state;
  return {
    ...state,
    document: structuredClone(previous),
    past: state.past.slice(0, -1),
    future: [structuredClone(state.document), ...state.future],
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
  };
}
