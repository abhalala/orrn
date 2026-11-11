/** The two worked examples of plan B2, as typed recipes. Used by the tests and by lanes that need a sample recipe. */
import { sha256Hex } from "./hash";
import type { Recipe } from "./recipe";

/** `v1|` plus the normalized headers joined by U+001F, hashed. The same rule as `headerKey` in fingerprint.ts. */
function keyOf(normalized: string[]): string {
  return sha256Hex(`v1|${normalized.join("\u001f")}`);
}

export const DIE_SHEET_HEADERS = [
  "Series",
  "Section code",
  "Min weight (kg/12ft)",
  "Max weight (kg/12ft)",
  "Name",
  "Width (mm)",
  "Thickness (mm)",
  "Leg (mm)",
  "Status",
  "Notes",
];
const dieNormalized = [
  "series",
  "section code",
  "min weight kg/12ft",
  "max weight kg/12ft",
  "name",
  "width mm",
  "thickness mm",
  "leg mm",
  "status",
  "notes",
];

const c = (col: number, header: string) => ({ kind: "columns" as const, cols: [{ col, header }] });

/** Example 1: the built-in die hole applied to the die template headers. */
export const EXAMPLE_DIE_RECIPE: Recipe = {
  schemaVersion: 1,
  target: "dies",
  headerRow: 0,
  headerRows: 1,
  match: { headerKey: keyOf(dieNormalized), headers: dieNormalized },
  fields: [
    { field: "series", source: c(0, "Series"), steps: [{ op: "trim" }, { op: "case", to: "upper" }] },
    { field: "sectionCode", source: c(1, "Section code"), steps: [{ op: "trim" }] },
    { field: "weightMinG", source: c(2, "Min weight (kg/12ft)"), steps: [{ op: "number", kind: "linear_mass", unit: "kg/12ft" }] },
    { field: "weightMaxG", source: c(3, "Max weight (kg/12ft)"), steps: [{ op: "number", kind: "linear_mass", unit: "kg/12ft" }] },
    { field: "name", source: c(4, "Name"), steps: [{ op: "trim" }] },
    { field: "widthMm", source: c(5, "Width (mm)"), steps: [{ op: "number", kind: "dimension", unit: "mm" }] },
    { field: "thicknessMm", source: c(6, "Thickness (mm)"), steps: [{ op: "number", kind: "dimension", unit: "mm" }] },
    { field: "legMm", source: c(7, "Leg (mm)"), steps: [{ op: "number", kind: "dimension", unit: "mm" }] },
    {
      field: "status",
      source: c(8, "Status"),
      steps: [
        { op: "trim" },
        { op: "case", to: "lower" },
        {
          op: "pick",
          map: [
            { from: "active", to: "active" },
            { from: "archived", to: "archived" },
          ],
          otherwise: "refuse",
        },
      ],
    },
    { field: "notes", source: c(9, "Notes"), steps: [{ op: "trim" }] },
  ],
  filters: [],
  keys: ["series", "sectionCode"],
  onExisting: "ask",
  unclear: [],
};

export const BAKI_SHEET_HEADERS = [
  "Sr",
  "Party Name",
  "Order No",
  "Date",
  "Section",
  "Wt (kg/12ft)",
  "Ord Qty (Kg)",
  "Disp (Kg)",
  "Baki (Kg)",
  "Rate",
  "Remarks",
];
const bakiNormalized = [
  "sr",
  "party name",
  "order no",
  "date",
  "section",
  "wt kg/12ft",
  "ord qty kg",
  "disp kg",
  "baki kg",
  "rate",
  "remarks",
];

/**
 * Example 2: the made-up baki workbook, as the bot or a person would produce it. Header row is row 1 (title above).
 * Plan B2 wrote the weight header as "Wt/12ft". It names no mass unit, so a bot naming kg/12ft for it would be a
 * guess (C4); the example header shows the unit.
 */
export const EXAMPLE_BAKI_RECIPE: Recipe = {
  schemaVersion: 1,
  target: "orders",
  headerRow: 1,
  headerRows: 1,
  match: { headerKey: keyOf(bakiNormalized), headers: bakiNormalized },
  fields: [
    { field: "customer", source: c(1, "Party Name"), steps: [{ op: "trim" }, { op: "lookup", resolver: "customer_by_name" }] },
    { field: "oldOrderNo", source: c(2, "Order No"), steps: [{ op: "trim" }] },
    { field: "orderDate", source: c(3, "Date"), steps: [{ op: "date", format: "dmy" }] },
    { field: "series", source: c(4, "Section"), steps: [{ op: "split", sep: " ", index: 0 }, { op: "case", to: "upper" }] },
    { field: "sectionCode", source: c(4, "Section"), steps: [{ op: "split", sep: " ", index: 1 }, { op: "lookup", resolver: "section_by_code" }] },
    { field: "kgPer12ft", source: c(5, "Wt (kg/12ft)"), steps: [{ op: "number", kind: "linear_mass", unit: "kg/12ft" }] },
    { field: "orderedKg", source: c(6, "Ord Qty (Kg)"), steps: [{ op: "number", kind: "mass", unit: "kg" }] },
    { field: "dispatchedKg", source: c(7, "Disp (Kg)"), steps: [{ op: "number", kind: "mass", unit: "kg" }] },
    { field: "bakiKg", source: c(8, "Baki (Kg)"), steps: [{ op: "number", kind: "mass", unit: "kg" }] },
    { field: "rate", source: c(9, "Rate"), steps: [{ op: "number", kind: "price_per_mass", unit: null }] },
    { field: "note", source: c(10, "Remarks"), steps: [{ op: "trim" }] },
  ],
  filters: [{ col: { col: 1, header: "Party Name" }, test: "not_blank", values: [], action: "keep" }],
  keys: ["customer", "oldOrderNo", "orderDate"],
  // Plan B2 wrote "skip". A bot recipe must ask (C3), so the example asks.
  onExisting: "ask",
  unclear: [{ field: "rate", code: "unit_unknown" }],
};
