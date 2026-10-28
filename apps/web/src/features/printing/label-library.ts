import { compactLabel, operationsDense, polishedLabel, type LabelDocument, type LabelElement } from "@orrn/domain";

import { labelDocumentFromSchema } from "./label-studio-model";

/**
 * The label library: the starting designs offered by New label, and what a design card says about
 * a stored design. Starters are laid out against what the TA220 prints (TSPL font "3": 2 × 3 mm per
 * size step of 3 mm; a QR is modules × cell with no quiet zone), so each one validates for the
 * TE200 and prints the sample bundle without overlaps or anything past the edge
 * (`label-library.test.ts`).
 */

type Page = LabelDocument["page"];

const page = (widthMm: number, heightMm: number): Page => ({ widthMm, heightMm, gapMm: 2, dpi: 203, speedInSec: 5, density: 8, direction: 0 });

/** The stock the built-ins use (4 × 3 in die-cut). */
const STANDARD = page(102.25, 76.2);

type TextSource = { variable: NonNullable<LabelElement["variable"]> } | { content: string };

function text(id: string, xMm: number, yMm: number, fontSizeMm: 3 | 6 | 9 | 12, source: TextSource): LabelElement {
  return { id, type: "text", xMm, yMm, rotation: 0, ...source, font: "Sans Serif", fontSizeMm, align: "left" };
}

/** `sideMm` is the box the studio shows; the printed side is modules × cell. */
function qr(id: string, xMm: number, yMm: number, cellMm: number, sideMm: number): LabelElement {
  return { id, type: "qrcode", xMm, yMm, widthMm: sideMm, heightMm: sideMm, rotation: 0, variable: "qr", level: "M", model: 2, mask: "auto", mode: "auto", cellMm, quietZoneMm: 2 };
}

function line(id: string, xMm: number, yMm: number, widthMm: number): LabelElement {
  return { id, type: "line", xMm, yMm, widthMm, rotation: 0, strokeMm: 0.25 };
}

function serialBarcode(id: string, xMm: number, yMm: number, heightMm: number): LabelElement {
  return { id, type: "barcode", xMm, yMm, heightMm, rotation: 0, variable: "serialNumber", symbology: "128", narrow: 2, wide: 2, humanReadable: true, quietZoneMm: 2 };
}

/** Dispatch: the total weight as big as fits beside the QR, the measures under it. */
export const dispatchWeightLabel: LabelDocument = {
  version: 1,
  page: STANDARD,
  elements: [
    text("serial", 4, 4, 6, { variable: "serialNumber" }),
    qr("qr", 74, 3, 0.75, 25),
    text("total-label", 4, 13, 3, { content: "Total weight" }),
    text("total", 4, 17, 9, { variable: "weight" }),
    text("series-label", 4, 31, 3, { content: "Series" }),
    text("series", 4, 35, 3, { variable: "seriesName" }),
    line("rule", 4, 41, 94),
    text("quantity-label", 4, 44, 3, { content: "Quantity" }),
    text("quantity", 4, 48, 6, { variable: "quantity" }),
    text("length-label", 38, 44, 3, { content: "Cut length" }),
    text("length", 38, 48, 6, { variable: "length" }),
    text("weight12-label", 74, 44, 3, { content: "Weight/12ft" }),
    text("weight12", 74, 48, 3, { variable: "weight12ft" }),
    text("po-label", 4, 58, 3, { content: "PO" }),
    text("po", 4, 62, 3, { variable: "poNumber" }),
    text("sales-order-label", 38, 58, 3, { content: "Sales order" }),
    text("sales-order", 38, 62, 3, { variable: "salesOrder" }),
    text("cast-label", 74, 58, 3, { content: "Cast" }),
    text("cast", 74, 62, 3, { variable: "cast" }),
  ],
};

/** Customer: the party's own bundle number and the QR first, order references, then the bundle. */
export const partyLabel: LabelDocument = {
  version: 1,
  page: STANDARD,
  elements: [
    text("party-label", 4, 4, 3, { content: "Party bundle" }),
    text("party", 4, 8, 6, { variable: "partyNo" }),
    qr("qr", 70, 4, 0.875, 29),
    text("sales-order-label", 4, 18, 3, { content: "Sales order" }),
    text("sales-order", 4, 22, 6, { variable: "salesOrder" }),
    text("po-label", 36, 18, 3, { content: "PO" }),
    text("po", 36, 22, 6, { variable: "poNumber" }),
    line("rule", 4, 36, 94),
    text("series-label", 4, 39, 3, { content: "Series" }),
    text("series", 4, 43, 3, { variable: "seriesName" }),
    text("serial-label", 4, 50, 3, { content: "Bundle" }),
    text("serial", 4, 54, 3, { variable: "serialNumber" }),
    text("quantity-label", 38, 50, 3, { content: "Quantity" }),
    text("quantity", 38, 54, 6, { variable: "quantity" }),
    text("total-label", 60, 50, 3, { content: "Total weight" }),
    text("total", 60, 54, 6, { variable: "weight" }),
    text("length-label", 4, 64, 3, { content: "Cut length" }),
    text("length", 30, 64, 3, { variable: "length" }),
  ],
};

/** 50 × 25 mm rack tag: QR on the left, bundle number and the numbers a rack check needs beside it. */
export const rackTag: LabelDocument = {
  version: 1,
  page: page(50, 25),
  elements: [
    qr("qr", 2, 4, 0.5, 16.5),
    text("serial", 21, 3, 3, { variable: "serialNumber" }),
    text("quantity", 21, 8, 6, { content: "{{quantity}} pcs" }),
    text("length", 21, 15, 3, { variable: "length" }),
    text("weight", 21, 19, 3, { variable: "weight" }),
  ],
};

/** 100 × 150 mm (4 × 6 in) shipping label: party, order, measures, weight and a scannable bundle. */
export const shippingLabel: LabelDocument = {
  version: 1,
  page: page(100, 150),
  elements: [
    text("party-label", 5, 5, 3, { content: "Ship to party" }),
    text("party", 5, 9, 9, { variable: "partyNo" }),
    line("rule-top", 5, 22, 90),
    text("sales-order-label", 5, 25, 3, { content: "Sales order" }),
    text("sales-order", 5, 29, 6, { variable: "salesOrder" }),
    text("po-label", 52, 25, 3, { content: "PO" }),
    text("po", 52, 29, 6, { variable: "poNumber" }),
    text("series-label", 5, 39, 3, { content: "Series" }),
    text("series", 5, 43, 6, { variable: "seriesName" }),
    text("quantity-label", 5, 53, 3, { content: "Quantity" }),
    text("quantity", 5, 57, 9, { variable: "quantity" }),
    text("length-label", 52, 53, 3, { content: "Cut length" }),
    text("length", 52, 57, 6, { variable: "length" }),
    line("rule-middle", 5, 70, 90),
    text("total-label", 5, 73, 3, { content: "Total weight" }),
    text("total", 5, 77, 12, { variable: "weight" }),
    line("rule-bottom", 5, 93, 90),
    text("serial-label", 5, 96, 3, { content: "Bundle" }),
    serialBarcode("serial-barcode", 5, 100, 14),
    qr("qr", 70, 96, 0.75, 25),
    text("serial", 5, 122, 6, { variable: "serialNumber" }),
    text("standard", 5, 132, 3, { variable: "standard" }),
    text("cml", 40, 132, 3, { variable: "cml" }),
  ],
};

/** Standard stock with only the bundle number: everything else is added in the studio. */
export const blankLabel: LabelDocument = {
  version: 1,
  page: STANDARD,
  elements: [text("serial", 4, 4, 6, { variable: "serialNumber" })],
};

export type StarterId = "operationsDense" | "polished" | "compact" | "dispatchWeight" | "party" | "rackTag" | "shipping" | "blank";

/** Ids double as the i18n keys `printing.library.starters.<id>.{name,note}`. */
export const LABEL_STARTERS: ReadonlyArray<{ id: StarterId; document: LabelDocument }> = [
  { id: "operationsDense", document: operationsDense },
  { id: "polished", document: polishedLabel },
  { id: "compact", document: compactLabel },
  { id: "dispatchWeight", document: dispatchWeightLabel },
  { id: "party", document: partyLabel },
  { id: "rackTag", document: rackTag },
  { id: "shipping", document: shippingLabel },
  { id: "blank", document: blankLabel },
];

/** "102.25 × 76.2 mm": the stock size as people read it on the roll. */
export function labelSize(document: Pick<LabelDocument, "page">): string {
  const [width, height] = [document.page.widthMm, document.page.heightMm].map((value) => Math.round(value * 100) / 100);
  return `${width} × ${height} mm`;
}

/** The `spool.labelDocuments.list` fields a design card reads its state from. */
export type StoredDesign = {
  schema: unknown;
  draftSchema: unknown;
  spoolPushedAt: Date | string | null;
  updatedAt: Date | string | null;
};

/**
 * What the card says about a stored design. The print computer gets the published schema
 * (`spool.pushTemplate`), so a draft that differs from it is "draft changes", and a design
 * published again after its last send (nothing but the draft changed since) has a newer version
 * waiting to be sent.
 */
export function designState(design: StoredDesign) {
  const hasDraft = design.draftSchema !== null && design.draftSchema !== undefined;
  const draftChanges = hasDraft && JSON.stringify(design.draftSchema) !== JSON.stringify(design.schema);
  const document = labelDocumentFromSchema(hasDraft ? design.draftSchema : design.schema);
  const sentAt = design.spoolPushedAt === null ? null : new Date(design.spoolPushedAt).getTime();
  const changedAt = design.updatedAt === null ? null : new Date(design.updatedAt).getTime();
  const send: "never" | "outdated" | "sent" =
    sentAt === null ? "never" : !draftChanges && changedAt !== null && changedAt > sentAt + 1000 ? "outdated" : "sent";
  return { document, draftChanges, send };
}

/** Case-insensitive name match; every design for an empty query. */
export function filterDesigns<T extends { name: string }>(designs: readonly T[], query: string): T[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...designs];
  return designs.filter((design) => design.name.toLocaleLowerCase().includes(needle));
}

/** Library search appears once the list no longer fits at a glance. */
export const SEARCH_THRESHOLD = 6;

/** A name for a new design that no stored design already has: "Base", "Base 2", "Base 3", … */
export function uniqueDesignName(base: string, taken: readonly string[]): string {
  const names = new Set(taken.map((name) => name.trim().toLocaleLowerCase()));
  if (!names.has(base.trim().toLocaleLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (!names.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

export const NAME_MAX = 255;

export type NameProblem = "required" | "tooLong" | "taken";

export function designNameProblem(name: string, taken: readonly string[]): NameProblem | null {
  const trimmed = name.trim();
  if (!trimmed) return "required";
  if (trimmed.length > NAME_MAX) return "tooLong";
  if (taken.some((existing) => existing.trim().toLocaleLowerCase() === trimmed.toLocaleLowerCase())) return "taken";
  return null;
}
