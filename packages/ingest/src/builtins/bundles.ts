import type { BuiltinHole } from "./types";

/**
 * From `columnGuide("bundles")` and `IMPORT_FIELDS.bundles`, plus the legacy id of plan B4. Rule 6.4 (M-R6-1): the
 * legacy id column is optional in the layout, so the web's old bundle template (which has none) fits exactly. Rule
 * 7.5: rows without one import only after the sheet's one question (bundles_no_old_id, server dry run).
 */
export const builtinBundles: BuiltinHole = {
  id: "bundles",
  version: 1,
  target: "bundles",
  keys: ["legacyId"],
  onExisting: "skip",
  fields: [
    { field: "legacyId", aliases: ["legacy id", "old id", "bundle id", "uid"] },
    { field: "series", aliases: ["die series", "series"], required: true, caseTo: "upper" },
    { field: "sectionCode", aliases: ["die section code", "section code", "section", "die section", "section no"], required: true },
    { field: "quantity", aliases: ["quantity", "qty", "pieces", "pcs", "piece", "nos"], required: true, unitFromHeader: "count" },
    { field: "weightG", aliases: ["weight", "net weight", "bundle weight", "wt"], required: true, unitFromHeader: "mass" },
    { field: "lengthMm", aliases: ["length", "cut length", "len"], required: true, unitFromHeader: "length" },
    { field: "poNumber", aliases: ["po number", "po no", "po", "po ref", "purchase order", "po num"] },
  ],
};
