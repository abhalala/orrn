import type { LabelDocument, LabelElement } from "@orrn/domain";

export interface LabelEditorState {
  document: LabelDocument;
  selectedIds: string[];
  past: LabelDocument[];
  future: LabelDocument[];
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
