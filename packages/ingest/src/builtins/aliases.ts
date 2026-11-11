/**
 * Header aliases and the unit-from-header reader, ported from apps/web/src/features/imports/parse.ts (plan A7).
 * Kept identical so a parity test can compare them: `IMPORT_FIELDS`, `readHeader`, `isPerTwelveFoot` and the bounds.
 * That web file stays untouched; the masters dialogs still use it.
 */

export type ImportKind = "bundles" | "dies" | "customers";
export type HeaderUnit = "mm" | "in" | "ft" | "kg" | "g" | "m";
export type FieldType = "text" | "count" | "weight" | "length" | "email" | "status";
export type FieldDef = { id: string; type: FieldType; aliases: readonly string[]; required?: boolean };

const UNIT_WORDS: Record<string, HeaderUnit> = {
  mm: "mm", millimetre: "mm", millimetres: "mm", millimeter: "mm", millimeters: "mm",
  in: "in", inch: "in", inches: "in",
  ft: "ft", feet: "ft", foot: "ft",
  kg: "kg", kgs: "kg", kilogram: "kg", kilograms: "kg",
  g: "g", gm: "g", gms: "g", gram: "g", grams: "g",
  m: "m", mtr: "m", mtrs: "m", metre: "m", metres: "m", meter: "m", meters: "m",
};

function unitOf(text: string): HeaderUnit | null {
  const word = text.trim().toLowerCase().replace(/\.$/, "");
  return UNIT_WORDS[word] ?? null;
}

/** A header that names a die band: `Weight Kg/12ft`, `kg per 12 ft`, `Wt (kg/12')`. */
export function isPerTwelveFoot(raw: string): boolean {
  return /(?:\/|\bper)\s*12\s*(?:ft|feet|foot|')/i.test(raw);
}

export type HeaderRead = { name: string; unit: HeaderUnit | null; unknownUnit?: string };

/** `"Length (mm)"` gives `{ name: "length", unit: "mm" }`. `kg/12ft` is kg. A bracket naming no unit is `unknownUnit`. */
export function readHeader(raw: string): HeaderRead {
  let text = raw.replace(/\s*(?:\/|per)\s*12\s*(?:ft|feet|foot|')/gi, "");
  let unit: HeaderUnit | null = null;
  let unknownUnit: string | undefined;

  text = text.replace(/[([]([^)\]]*)[)\]]/g, (_whole, inner: string) => {
    const found = unitOf(inner.replace(/^\s*(?:in|per)\s+/i, ""));
    if (found) unit ??= found;
    else if (inner.trim() !== "") unknownUnit ??= inner.trim();
    return " ";
  });

  const words = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  if (unit === null && words.length > 1) {
    const last = unitOf(words[words.length - 1]!);
    if (last) {
      unit = last;
      words.pop();
      while (words.length > 1 && (words[words.length - 1] === "in" || words[words.length - 1] === "per")) words.pop();
    }
  }
  const read: HeaderRead = { name: words.join(" "), unit };
  if (unit === null && unknownUnit !== undefined) read.unknownUnit = unknownUnit;
  return read;
}

export const IMPORT_FIELDS: Record<ImportKind, readonly FieldDef[]> = {
  bundles: [
    { id: "dieSeries", type: "text", required: true, aliases: ["die series", "series"] },
    {
      id: "dieSectionCode",
      type: "text",
      required: true,
      aliases: ["die section code", "section code", "section", "die section", "section no"],
    },
    { id: "quantity", type: "count", required: true, aliases: ["quantity", "qty", "pieces", "pcs", "piece", "nos"] },
    { id: "weight", type: "weight", required: true, aliases: ["weight", "net weight", "bundle weight", "wt"] },
    { id: "length", type: "length", required: true, aliases: ["length", "cut length", "len"] },
    { id: "poNumber", type: "text", aliases: ["po number", "po no", "po", "po ref", "purchase order", "po num"] },
  ],
  dies: [
    { id: "series", type: "text", required: true, aliases: ["series", "die series"] },
    { id: "sectionCode", type: "text", required: true, aliases: ["section code", "section", "die section code", "die section"] },
    { id: "name", type: "text", aliases: ["name", "die name", "description"] },
    {
      id: "weightMin",
      type: "weight",
      required: true,
      aliases: ["min weight", "weight min", "min", "minimum weight", "min wt", "range min"],
    },
    {
      id: "weightMax",
      type: "weight",
      required: true,
      aliases: ["max weight", "weight max", "max", "maximum weight", "max wt", "range max"],
    },
    { id: "width", type: "length", aliases: ["width", "dimensions width"] },
    { id: "height", type: "length", aliases: ["height", "dimensions height"] },
    { id: "thickness", type: "length", aliases: ["thickness", "dimensions thickness", "thk"] },
    { id: "leg", type: "length", aliases: ["leg"] },
    { id: "status", type: "status", aliases: ["status"] },
    { id: "notes", type: "text", aliases: ["notes", "note", "remarks"] },
  ],
  customers: [
    { id: "name", type: "text", required: true, aliases: ["name", "customer", "customer name", "party", "party name"] },
    { id: "phone", type: "text", aliases: ["phone", "mobile", "phone number", "mobile number", "contact"] },
    { id: "email", type: "email", aliases: ["email", "e mail", "email address"] },
    { id: "taxId", type: "text", aliases: ["gstin", "gst", "gst no", "gst number", "gstin no", "tax id"] },
    { id: "notes", type: "text", aliases: ["notes", "note", "remarks"] },
  ],
};

/** Same bounds as the web parser. The target validators import these from `targets/`. */
export { BUNDLE_LENGTH_MM, BUNDLE_MAX_WEIGHT_G } from "../targets/bundles";
export { DIE_MAX_BAND_G } from "../targets/dies";
